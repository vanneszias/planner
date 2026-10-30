import { type Db, schema, uuidv7 } from '@app/db'
import { and, asc, count, eq, sql } from 'drizzle-orm'
import type { ParticipantContext } from './registrations.ts'

/*
 * First-come-first-served booking (D1, journeys.md P1). In production every
 * call runs inside the event's Durable Object, which serialises them; the
 * guarded insert below still enforces capacity, overlap and the per-person
 * limit by itself, so a second write path can never overbook
 * (docs/decisions.md, "Capacity enforcement").
 */

export type BookingRefusal =
	| 'not_found' // no such session in this event
	| 'closed' // event not open for booking (mode, status or window)
	| 'not_eligible' // their age group can't join this workshop
	| 'already_booked' // they already have this session
	| 'same_workshop' // they already have another session of this workshop
	| 'overlap' // clashes with something they booked
	| 'limit' // they already have their sessions per person
	| 'full' // no seats left: offer the waitlist

export type BookingResult = { ok: true } | { ok: false; reason: BookingRefusal }

type SessionFacts = {
	id: string
	eventId: string
	workshopId: string
	startsAt: Date
	endsAt: Date
	capacity: number
	status: 'scheduled' | 'cancelled'
	mode: 'booking' | 'ranking'
	eventStatus: 'draft' | 'published' | 'closed' | 'archived'
	opensAt: Date | null
	closesAt: Date | null
	changeCutoff: 'booking-closes' | 'session-start'
	sessionsPerParticipant: number
}

async function sessionFacts(
	db: Db,
	eventId: string,
	sessionId: string,
): Promise<SessionFacts | null> {
	const [found] = await db
		.select({
			id: schema.eventSession.id,
			eventId: schema.eventSession.eventId,
			workshopId: schema.eventSession.workshopId,
			startsAt: schema.eventSession.startsAt,
			endsAt: schema.eventSession.endsAt,
			capacity: schema.eventSession.capacity,
			status: schema.eventSession.status,
			mode: schema.event.mode,
			eventStatus: schema.event.status,
			opensAt: schema.event.opensAt,
			closesAt: schema.event.closesAt,
			changeCutoff: schema.event.changeCutoff,
			sessionsPerParticipant: schema.event.sessionsPerParticipant,
		})
		.from(schema.eventSession)
		.innerJoin(schema.event, eq(schema.event.id, schema.eventSession.eventId))
		.where(and(eq(schema.eventSession.id, sessionId), eq(schema.eventSession.eventId, eventId)))
		.limit(1)
	return found ?? null
}

/** Booking is open: booking mode, published, inside the window if one is set. */
export function bookingOpen(
	facts: Pick<SessionFacts, 'mode' | 'eventStatus' | 'opensAt' | 'closesAt'>,
	now: Date,
): boolean {
	if (facts.mode !== 'booking' || facts.eventStatus !== 'published') return false
	if (facts.opensAt && now < facts.opensAt) return false
	if (facts.closesAt && now >= facts.closesAt) return false
	return true
}

async function eligible(db: Db, registrationId: string, workshopId: string): Promise<boolean> {
	const limits = await db
		.select({ ageGroupId: schema.workshopAgeGroup.ageGroupId })
		.from(schema.workshopAgeGroup)
		.where(eq(schema.workshopAgeGroup.workshopId, workshopId))
	if (limits.length === 0) return true
	const [registration] = await db
		.select({ ageGroupId: schema.registration.ageGroupId })
		.from(schema.registration)
		.where(eq(schema.registration.id, registrationId))
		.limit(1)
	return limits.some((limit) => limit.ageGroupId === registration?.ageGroupId)
}

/**
 * The guarded insert: one statement, so it is atomic on its own. Inserts only
 * if the session has a free seat, the participant is under their limit, and
 * nothing they hold overlaps it or is the same workshop.
 */
async function guardedInsert(
	db: Db,
	registrationId: string,
	sessionId: string,
	limit: number,
	source: 'booking' | 'manual' = 'booking',
): Promise<boolean> {
	const result = await db.run(sql`
		INSERT INTO assignment (id, organization_id, event_id, registration_id, session_id, source, locked, created_at)
		SELECT ${uuidv7()}, t.organization_id, t.event_id, ${registrationId}, t.id, ${source}, 0, ${Date.now()}
		FROM event_session t
		WHERE t.id = ${sessionId}
			AND t.status = 'scheduled'
			AND (SELECT count(*) FROM assignment WHERE session_id = t.id) < t.capacity
			AND (SELECT count(*) FROM assignment WHERE registration_id = ${registrationId}) < ${limit}
			AND NOT EXISTS (
				SELECT 1 FROM assignment a
				JOIN event_session s ON s.id = a.session_id
				WHERE a.registration_id = ${registrationId}
					AND (s.workshop_id = t.workshop_id OR (s.starts_at < t.ends_at AND t.starts_at < s.ends_at))
			)
	`)
	return (result.meta.changes ?? 0) > 0
}

/** Explains a refused insert, after the fact, for the message shown to the participant. */
async function whyRefused(
	db: Db,
	registrationId: string,
	facts: SessionFacts,
): Promise<BookingRefusal> {
	const held = await db
		.select({
			sessionId: schema.assignment.sessionId,
			workshopId: schema.eventSession.workshopId,
			startsAt: schema.eventSession.startsAt,
			endsAt: schema.eventSession.endsAt,
		})
		.from(schema.assignment)
		.innerJoin(schema.eventSession, eq(schema.eventSession.id, schema.assignment.sessionId))
		.where(eq(schema.assignment.registrationId, registrationId))
	if (held.some((h) => h.sessionId === facts.id)) return 'already_booked'
	if (held.some((h) => h.workshopId === facts.workshopId)) return 'same_workshop'
	if (held.some((h) => h.startsAt < facts.endsAt && facts.startsAt < h.endsAt)) return 'overlap'
	if (held.length >= facts.sessionsPerParticipant) return 'limit'
	return 'full'
}

export async function bookSession(
	db: Db,
	context: ParticipantContext,
	sessionId: string,
	now = new Date(),
): Promise<BookingResult> {
	const facts = await sessionFacts(db, context.eventId, sessionId)
	if (facts?.status !== 'scheduled') return { ok: false, reason: 'not_found' }
	if (!bookingOpen(facts, now)) return { ok: false, reason: 'closed' }
	if (!(await eligible(db, context.registrationId, facts.workshopId))) {
		return { ok: false, reason: 'not_eligible' }
	}
	if (await guardedInsert(db, context.registrationId, sessionId, facts.sessionsPerParticipant)) {
		// A booked session replaces any waitlist place for it.
		await db
			.delete(schema.waitlistEntry)
			.where(
				and(
					eq(schema.waitlistEntry.sessionId, sessionId),
					eq(schema.waitlistEntry.registrationId, context.registrationId),
				),
			)
		return { ok: true }
	}
	return { ok: false, reason: await whyRefused(db, context.registrationId, facts) }
}

/** Who got a freed seat, for their notification. */
export type Promotion = { registrationId: string; sessionId: string }

/**
 * Gives a freed seat to the first person on the waitlist who can take it.
 * People it no longer fits (overlap, limit) keep their place for later.
 */
export async function promoteFromWaitlist(db: Db, sessionId: string): Promise<Promotion | null> {
	const [facts] = await db
		.select({ limit: schema.event.sessionsPerParticipant })
		.from(schema.eventSession)
		.innerJoin(schema.event, eq(schema.event.id, schema.eventSession.eventId))
		.where(eq(schema.eventSession.id, sessionId))
		.limit(1)
	if (!facts) return null
	const waiting = await db
		.select({ id: schema.waitlistEntry.id, registrationId: schema.waitlistEntry.registrationId })
		.from(schema.waitlistEntry)
		.where(eq(schema.waitlistEntry.sessionId, sessionId))
		.orderBy(asc(schema.waitlistEntry.createdAt), asc(schema.waitlistEntry.id))
	for (const entry of waiting) {
		if (await guardedInsert(db, entry.registrationId, sessionId, facts.limit)) {
			await db.delete(schema.waitlistEntry).where(eq(schema.waitlistEntry.id, entry.id))
			return { registrationId: entry.registrationId, sessionId }
		}
	}
	return null
}

export type CancelResult =
	| { ok: true; promoted: Promotion | null }
	| { ok: false; reason: 'not_found' | 'too_late' }

/** Cancels a booking within the event's change cut-off (D22), then fills the seat from the waitlist. */
export async function cancelBooking(
	db: Db,
	context: ParticipantContext,
	sessionId: string,
	now = new Date(),
): Promise<CancelResult> {
	const facts = await sessionFacts(db, context.eventId, sessionId)
	if (!facts) return { ok: false, reason: 'not_found' }
	const deadline = facts.changeCutoff === 'session-start' ? facts.startsAt : facts.closesAt
	if (deadline && now >= deadline) return { ok: false, reason: 'too_late' }

	const deleted = await db
		.delete(schema.assignment)
		.where(
			and(
				eq(schema.assignment.registrationId, context.registrationId),
				eq(schema.assignment.sessionId, sessionId),
				eq(schema.assignment.source, 'booking'),
			),
		)
		.returning({ id: schema.assignment.id })
	if (deleted.length === 0) return { ok: false, reason: 'not_found' }
	return { ok: true, promoted: await promoteFromWaitlist(db, sessionId) }
}

/** Joins the waitlist of a full session. Returns the place in line (1-based). */
export async function joinWaitlist(
	db: Db,
	context: ParticipantContext,
	sessionId: string,
	now = new Date(),
): Promise<{ ok: true; position: number } | { ok: false; reason: BookingRefusal }> {
	const facts = await sessionFacts(db, context.eventId, sessionId)
	if (facts?.status !== 'scheduled') return { ok: false, reason: 'not_found' }
	if (!bookingOpen(facts, now)) return { ok: false, reason: 'closed' }
	if (!(await eligible(db, context.registrationId, facts.workshopId))) {
		return { ok: false, reason: 'not_eligible' }
	}
	const [{ taken } = { taken: 0 }] = await db
		.select({ taken: count() })
		.from(schema.assignment)
		.where(eq(schema.assignment.sessionId, sessionId))
	// A seat is free: book instead of queueing.
	if (taken < facts.capacity) {
		const booked = await bookSession(db, context, sessionId, now)
		return booked.ok ? { ok: false, reason: 'already_booked' } : booked
	}
	await db
		.insert(schema.waitlistEntry)
		.values({
			organizationId: context.organizationId,
			eventId: context.eventId,
			sessionId,
			registrationId: context.registrationId,
		})
		.onConflictDoNothing()
	return { ok: true, position: await waitlistPosition(db, context.registrationId, sessionId) }
}

export async function leaveWaitlist(db: Db, context: ParticipantContext, sessionId: string) {
	await db
		.delete(schema.waitlistEntry)
		.where(
			and(
				eq(schema.waitlistEntry.sessionId, sessionId),
				eq(schema.waitlistEntry.registrationId, context.registrationId),
			),
		)
}

async function waitlistPosition(db: Db, registrationId: string, sessionId: string) {
	const entries = await db
		.select({ registrationId: schema.waitlistEntry.registrationId })
		.from(schema.waitlistEntry)
		.where(eq(schema.waitlistEntry.sessionId, sessionId))
		.orderBy(asc(schema.waitlistEntry.createdAt), asc(schema.waitlistEntry.id))
	return entries.findIndex((e) => e.registrationId === registrationId) + 1
}

/** Seats taken per session, for the programme and live updates. Contains no personal data. */
export async function seatCounts(db: Db, eventId: string): Promise<Record<string, number>> {
	const rows = await db
		.select({ sessionId: schema.assignment.sessionId, taken: count() })
		.from(schema.assignment)
		.where(eq(schema.assignment.eventId, eventId))
		.groupBy(schema.assignment.sessionId)
	return Object.fromEntries(rows.map((r) => [r.sessionId, r.taken]))
}

/** A participant's own bookings and waitlist places, with their position in line. */
export async function participantPlan(db: Db, context: ParticipantContext) {
	const [bookings, waitlist] = await Promise.all([
		db
			.select({ sessionId: schema.assignment.sessionId, source: schema.assignment.source })
			.from(schema.assignment)
			.where(
				and(
					eq(schema.assignment.registrationId, context.registrationId),
					eq(schema.assignment.eventId, context.eventId),
				),
			),
		db
			.select({ sessionId: schema.waitlistEntry.sessionId })
			.from(schema.waitlistEntry)
			.where(eq(schema.waitlistEntry.registrationId, context.registrationId)),
	])
	const positions = await Promise.all(
		waitlist.map(async (w) => ({
			sessionId: w.sessionId,
			position: await waitlistPosition(db, context.registrationId, w.sessionId),
		})),
	)
	return { bookings, waitlist: positions }
}
