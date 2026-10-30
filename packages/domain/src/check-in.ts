import { type Db, schema } from '@app/db'
import { and, asc, count, eq, sql } from 'drizzle-orm'
import { auditStatement } from './audit.ts'
import { type OrganizerContext, requirePermission } from './context.ts'
import { getEvent } from './events.ts'
import { contextFromCode, contextFromToken } from './registrations.ts'
import { normalizeShortCode } from './tokens.ts'

/*
 * Event day check-in (journeys.md, O8; D15, D17). Organizers scan the QR on a
 * code card or email (the private link), type the 6-character code, or pick a
 * name. Per session it marks the assignment; for the whole event it marks the
 * registration. Runs inside the event's Durable Object, which broadcasts the
 * new counts to organizer screens.
 */

/** What a scan or a typed code says: a private link token, or a short code. */
export type CheckInCredential = { token: string } | { code: string } | { registrationId: string }

/**
 * Reads what the scanner or the code field produced: a private link
 * (`…/r/<token>`), a bare token, or a short code. Null if it's none of these.
 */
export function credentialFromScan(text: string): CheckInCredential | null {
	const value = text.trim()
	const link = value.match(/\/r\/([A-Za-z0-9_-]{16,64})(?:[/?#]|$)/)
	if (link?.[1]) return { token: link[1] }
	if (normalizeShortCode(value).length === 6 && /^[\w\s-]+$/.test(value)) return { code: value }
	if (/^[A-Za-z0-9_-]{22}$/.test(value)) return { token: value }
	return null
}

export type CheckInPerson = {
	registrationId: string
	name: string
	ageGroup: string | null
}

export type CheckInResult =
	| {
			ok: true
			status: 'checked_in' | 'already'
			person: CheckInPerson
			/** Event-wide or this session's check-in time. */
			at: number
	  }
	| {
			ok: false
			reason: 'unknown' | 'session_not_found'
	  }
	| {
			ok: false
			reason: 'not_booked'
			person: CheckInPerson
			/** The workshop they are booked for at this time instead, if any. */
			bookedElsewhere: string | null
	  }

export type CheckInInput = {
	/** Null: check in for the whole event. */
	sessionId: string | null
	credential: CheckInCredential
	/** "Check in anyway" for someone not booked for this session: adds a manual place. */
	force?: boolean
}

async function resolvePerson(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
	credential: CheckInCredential,
): Promise<CheckInPerson | null> {
	let registrationId: string | null = null
	if ('token' in credential) {
		const found = await contextFromToken(db, credential.token)
		// A link for another event says nothing: never reveal it exists.
		if (found?.eventId === eventId) registrationId = found.registrationId
	} else if ('code' in credential) {
		registrationId = (await contextFromCode(db, eventId, credential.code))?.registrationId ?? null
	} else {
		registrationId = credential.registrationId
	}
	if (!registrationId) return null
	const [found] = await db
		.select({
			registrationId: schema.registration.id,
			name: schema.registration.displayName,
			ageGroup: schema.ageGroup.label,
		})
		.from(schema.registration)
		.leftJoin(schema.ageGroup, eq(schema.ageGroup.id, schema.registration.ageGroupId))
		.where(
			and(
				eq(schema.registration.id, registrationId),
				eq(schema.registration.eventId, eventId),
				eq(schema.registration.organizationId, ctx.organizationId),
				eq(schema.registration.status, 'active'),
			),
		)
		.limit(1)
	return found ?? null
}

export async function checkIn(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
	input: CheckInInput,
	now = new Date(),
): Promise<CheckInResult> {
	requirePermission(ctx, { participant: ['write'] })
	await getEvent(db, ctx, eventId)
	const person = await resolvePerson(db, ctx, eventId, input.credential)
	if (!person) return { ok: false, reason: 'unknown' }
	const audit = (status: string) =>
		auditStatement(db, ctx, {
			action: 'checkin.add',
			subjectType: 'registration',
			subjectId: person.registrationId,
			eventId,
			data: { sessionId: input.sessionId, status },
		})

	if (!input.sessionId) {
		const [marked] = await db
			.update(schema.registration)
			.set({ checkedInAt: now, checkedInBy: ctx.userId })
			.where(
				and(
					eq(schema.registration.id, person.registrationId),
					sql`${schema.registration.checkedInAt} is null`,
				),
			)
			.returning({ at: schema.registration.checkedInAt })
		if (marked?.at) {
			await audit('checked_in')
			return { ok: true, status: 'checked_in', person, at: marked.at.getTime() }
		}
		const [current] = await db
			.select({ at: schema.registration.checkedInAt })
			.from(schema.registration)
			.where(eq(schema.registration.id, person.registrationId))
		return { ok: true, status: 'already', person, at: current?.at?.getTime() ?? now.getTime() }
	}

	const [session] = await db
		.select({
			id: schema.eventSession.id,
			startsAt: schema.eventSession.startsAt,
			endsAt: schema.eventSession.endsAt,
		})
		.from(schema.eventSession)
		.where(
			and(
				eq(schema.eventSession.id, input.sessionId),
				eq(schema.eventSession.eventId, eventId),
				eq(schema.eventSession.organizationId, ctx.organizationId),
			),
		)
		.limit(1)
	if (!session) return { ok: false, reason: 'session_not_found' }

	const [place] = await db
		.select({ id: schema.assignment.id, at: schema.assignment.checkedInAt })
		.from(schema.assignment)
		.where(
			and(
				eq(schema.assignment.registrationId, person.registrationId),
				eq(schema.assignment.sessionId, session.id),
			),
		)
		.limit(1)

	if (!place) {
		if (!input.force) {
			// Where they should be instead, so the volunteer can send them there.
			const [elsewhere] = await db
				.select({ title: schema.workshop.title })
				.from(schema.assignment)
				.innerJoin(schema.eventSession, eq(schema.eventSession.id, schema.assignment.sessionId))
				.innerJoin(schema.workshop, eq(schema.workshop.id, schema.eventSession.workshopId))
				.where(
					and(
						eq(schema.assignment.registrationId, person.registrationId),
						sql`${schema.eventSession.startsAt} < ${session.endsAt.getTime()}`,
						sql`${session.startsAt.getTime()} < ${schema.eventSession.endsAt}`,
					),
				)
				.limit(1)
			return { ok: false, reason: 'not_booked', person, bookedElsewhere: elsewhere?.title ?? null }
		}
		// They are here, so they get a place, even past capacity: the room is the limit now.
		await db
			.insert(schema.assignment)
			.values({
				organizationId: ctx.organizationId,
				eventId,
				registrationId: person.registrationId,
				sessionId: session.id,
				source: 'manual',
				checkedInAt: now,
				checkedInBy: ctx.userId,
			})
			.onConflictDoNothing()
		await audit('checked_in_anyway')
		return { ok: true, status: 'checked_in', person, at: now.getTime() }
	}

	if (place.at) return { ok: true, status: 'already', person, at: place.at.getTime() }
	await db
		.update(schema.assignment)
		.set({ checkedInAt: now, checkedInBy: ctx.userId })
		.where(eq(schema.assignment.id, place.id))
	await audit('checked_in')
	return { ok: true, status: 'checked_in', person, at: now.getTime() }
}

/** Undoes a check-in (a wrong tap or a wrong card). The place itself stays. */
export async function undoCheckIn(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
	sessionId: string | null,
	registrationId: string,
): Promise<void> {
	requirePermission(ctx, { participant: ['write'] })
	await getEvent(db, ctx, eventId)
	if (sessionId) {
		await db
			.update(schema.assignment)
			.set({ checkedInAt: null, checkedInBy: null })
			.where(
				and(
					eq(schema.assignment.registrationId, registrationId),
					eq(schema.assignment.sessionId, sessionId),
					eq(schema.assignment.organizationId, ctx.organizationId),
				),
			)
	} else {
		await db
			.update(schema.registration)
			.set({ checkedInAt: null, checkedInBy: null })
			.where(
				and(
					eq(schema.registration.id, registrationId),
					eq(schema.registration.eventId, eventId),
					eq(schema.registration.organizationId, ctx.organizationId),
				),
			)
	}
	await auditStatement(db, ctx, {
		action: 'checkin.undo',
		subjectType: 'registration',
		subjectId: registrationId,
		eventId,
		data: { sessionId },
	})
}

/** Counts only, no personal data: safe to broadcast to organizer screens. */
export type CheckInCounts = {
	/** Per session: places and how many of them are checked in. */
	sessions: Record<string, { booked: number; here: number }>
	event: { registered: number; here: number }
}

export async function checkInCounts(db: Db, eventId: string): Promise<CheckInCounts> {
	const [sessions, [people]] = await Promise.all([
		db
			.select({
				sessionId: schema.assignment.sessionId,
				booked: count(),
				here: count(schema.assignment.checkedInAt),
			})
			.from(schema.assignment)
			.where(eq(schema.assignment.eventId, eventId))
			.groupBy(schema.assignment.sessionId),
		db
			.select({ registered: count(), here: count(schema.registration.checkedInAt) })
			.from(schema.registration)
			.where(
				and(eq(schema.registration.eventId, eventId), eq(schema.registration.status, 'active')),
			),
	])
	return {
		sessions: Object.fromEntries(
			sessions.map((s) => [s.sessionId, { booked: s.booked, here: s.here }]),
		),
		event: { registered: people?.registered ?? 0, here: people?.here ?? 0 },
	}
}

/** The counts for an organizer's check-in screen, scoped to their organization. */
export async function checkInOverview(db: Db, ctx: OrganizerContext, eventId: string) {
	requirePermission(ctx, { participant: ['read'] })
	await getEvent(db, ctx, eventId)
	return checkInCounts(db, eventId)
}

export type RosterEntry = {
	registrationId: string
	name: string
	ageGroup: string | null
	checkedInAt: number | null
}

/**
 * Everyone expected in a session (or at the event), for name search and the
 * printable attendance list (D17). Reading names is audit-logged (D14).
 */
export async function checkInRoster(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
	sessionId: string | null,
): Promise<RosterEntry[]> {
	requirePermission(ctx, { participant: ['read'] })
	await getEvent(db, ctx, eventId)
	const rows = sessionId
		? await db
				.select({
					registrationId: schema.registration.id,
					name: schema.registration.displayName,
					ageGroup: schema.ageGroup.label,
					checkedInAt: schema.assignment.checkedInAt,
				})
				.from(schema.assignment)
				.innerJoin(
					schema.registration,
					eq(schema.registration.id, schema.assignment.registrationId),
				)
				.leftJoin(schema.ageGroup, eq(schema.ageGroup.id, schema.registration.ageGroupId))
				.where(
					and(
						eq(schema.assignment.sessionId, sessionId),
						eq(schema.assignment.eventId, eventId),
						eq(schema.assignment.organizationId, ctx.organizationId),
					),
				)
				.orderBy(asc(schema.registration.displayName))
		: await db
				.select({
					registrationId: schema.registration.id,
					name: schema.registration.displayName,
					ageGroup: schema.ageGroup.label,
					checkedInAt: schema.registration.checkedInAt,
				})
				.from(schema.registration)
				.leftJoin(schema.ageGroup, eq(schema.ageGroup.id, schema.registration.ageGroupId))
				.where(
					and(
						eq(schema.registration.eventId, eventId),
						eq(schema.registration.organizationId, ctx.organizationId),
						eq(schema.registration.status, 'active'),
					),
				)
				.orderBy(asc(schema.registration.displayName))
	await auditStatement(db, ctx, {
		action: 'checkin.roster',
		subjectType: sessionId ? 'event_session' : 'event',
		subjectId: sessionId ?? eventId,
		eventId,
	})
	return rows.map((r) => ({ ...r, checkedInAt: r.checkedInAt?.getTime() ?? null }))
}
