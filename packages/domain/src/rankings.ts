import type { TraceEntry } from '@app/allocation'
import { type Db, schema } from '@app/db'
import { and, asc, count, eq, isNotNull, isNull } from 'drizzle-orm'
import { auditStatement } from './audit.ts'
import { type OrganizerContext, requirePermission } from './context.ts'
import { notFound } from './errors.ts'
import { getEvent } from './events.ts'
import type { ParticipantContext } from './registrations.ts'

/*
 * Ranked preferences (D1, journeys.md P2). Participants rank workshops, not
 * sessions; the allocation engine picks the sessions.
 */

export type RankingRefusal =
	| 'closed' // not a ranking event, not published, or outside the window
	| 'too_few' // fewer than the event's minimum (D26)
	| 'too_many' // more than the event's limit (D8)
	| 'duplicate'
	| 'not_eligible' // a workshop their age group can't join
	| 'unknown_workshop'

export type RankingResult = { ok: true } | { ok: false; reason: RankingRefusal }

type RankingEvent = {
	id: string
	organizationId: string
	mode: 'booking' | 'ranking'
	status: 'draft' | 'published' | 'closed' | 'archived'
	opensAt: Date | null
	closesAt: Date | null
	rankLimit: number
	rankMinimum: number | null
	sessionsPerParticipant: number
}

async function rankingEvent(db: Db, eventId: string): Promise<RankingEvent | null> {
	const [found] = await db
		.select({
			id: schema.event.id,
			organizationId: schema.event.organizationId,
			mode: schema.event.mode,
			status: schema.event.status,
			opensAt: schema.event.opensAt,
			closesAt: schema.event.closesAt,
			rankLimit: schema.event.rankLimit,
			rankMinimum: schema.event.rankMinimum,
			sessionsPerParticipant: schema.event.sessionsPerParticipant,
		})
		.from(schema.event)
		.where(eq(schema.event.id, eventId))
		.limit(1)
	return found ?? null
}

export function rankingOpen(
	event: Pick<RankingEvent, 'mode' | 'status' | 'opensAt' | 'closesAt'>,
	now: Date,
) {
	if (event.mode !== 'ranking' || event.status !== 'published') return false
	if (event.opensAt && now < event.opensAt) return false
	if (event.closesAt && now >= event.closesAt) return false
	return true
}

/** Workshops this registration may rank: all of the event's, minus age-limited ones not for them. */
export async function rankableWorkshopIds(db: Db, eventId: string, registrationId: string) {
	const [registration] = await db
		.select({ ageGroupId: schema.registration.ageGroupId })
		.from(schema.registration)
		.where(eq(schema.registration.id, registrationId))
		.limit(1)
	const [workshops, limits] = await Promise.all([
		db
			.select({ id: schema.workshop.id })
			.from(schema.workshop)
			.where(eq(schema.workshop.eventId, eventId)),
		db
			.select({
				workshopId: schema.workshopAgeGroup.workshopId,
				ageGroupId: schema.workshopAgeGroup.ageGroupId,
			})
			.from(schema.workshopAgeGroup)
			.innerJoin(schema.workshop, eq(schema.workshop.id, schema.workshopAgeGroup.workshopId))
			.where(eq(schema.workshop.eventId, eventId)),
	])
	const limitedTo = new Map<string, string[]>()
	for (const l of limits)
		limitedTo.set(l.workshopId, [...(limitedTo.get(l.workshopId) ?? []), l.ageGroupId])
	return new Set(
		workshops
			.filter((w) => {
				const groups = limitedTo.get(w.id)
				return (
					!groups || (registration?.ageGroupId != null && groups.includes(registration.ageGroupId))
				)
			})
			.map((w) => w.id),
	)
}

/** The minimum to rank: the event's setting, or sessions + 1 (D26), never more than can be ranked. */
export function minimumRanks(
	event: Pick<RankingEvent, 'rankMinimum' | 'sessionsPerParticipant' | 'rankLimit'>,
	available: number,
) {
	const wanted = event.rankMinimum ?? event.sessionsPerParticipant + 1
	return Math.min(wanted, event.rankLimit, available)
}

async function validateAndSave(
	db: Db,
	event: RankingEvent,
	registrationId: string,
	workshopIds: string[],
): Promise<RankingResult> {
	if (new Set(workshopIds).size !== workshopIds.length) return { ok: false, reason: 'duplicate' }
	const rankable = await rankableWorkshopIds(db, event.id, registrationId)
	const all = new Set(
		(
			await db
				.select({ id: schema.workshop.id })
				.from(schema.workshop)
				.where(eq(schema.workshop.eventId, event.id))
		).map((w) => w.id),
	)
	if (workshopIds.some((id) => !all.has(id))) return { ok: false, reason: 'unknown_workshop' }
	if (workshopIds.some((id) => !rankable.has(id))) return { ok: false, reason: 'not_eligible' }
	if (workshopIds.length > event.rankLimit) return { ok: false, reason: 'too_many' }
	if (workshopIds.length < minimumRanks(event, rankable.size))
		return { ok: false, reason: 'too_few' }

	await db.batch([
		db.delete(schema.preference).where(eq(schema.preference.registrationId, registrationId)),
		...workshopIds.map((workshopId, index) =>
			db.insert(schema.preference).values({
				registrationId,
				workshopId,
				rank: index + 1,
				eventId: event.id,
				organizationId: event.organizationId,
			}),
		),
		// The first submission counts for "Early birds first": editing later doesn't lose your place.
		db
			.update(schema.registration)
			.set({ preferencesSubmittedAt: new Date() })
			.where(
				and(
					eq(schema.registration.id, registrationId),
					isNull(schema.registration.preferencesSubmittedAt),
				),
			),
	])
	return { ok: true }
}

/** A participant saves their ranking while the ranking window is open. */
export async function savePreferences(
	db: Db,
	context: ParticipantContext,
	workshopIds: string[],
	now = new Date(),
): Promise<RankingResult> {
	const event = await rankingEvent(db, context.eventId)
	if (!event || !rankingOpen(event, now)) return { ok: false, reason: 'closed' }
	return validateAndSave(db, event, context.registrationId, workshopIds)
}

/** An organizer enters a ranking for someone (D16 fallback); allowed after the window closes. */
export async function setPreferencesFor(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
	registrationId: string,
	workshopIds: string[],
): Promise<RankingResult> {
	requirePermission(ctx, { participant: ['write'] })
	await getEvent(db, ctx, eventId)
	const [registration] = await db
		.select({ id: schema.registration.id })
		.from(schema.registration)
		.where(
			and(
				eq(schema.registration.id, registrationId),
				eq(schema.registration.eventId, eventId),
				eq(schema.registration.organizationId, ctx.organizationId),
			),
		)
		.limit(1)
	if (!registration) throw notFound('Registration')
	const event = (await rankingEvent(db, eventId)) as RankingEvent
	const result = await validateAndSave(db, event, registrationId, workshopIds)
	if (result.ok) {
		await auditStatement(db, ctx, {
			action: 'preferences.set',
			subjectType: 'registration',
			subjectId: registrationId,
			eventId,
		})
	}
	return result
}

/** What an organizer needs to enter someone's ranking: their current one, what they may rank, and the limits. */
export async function rankingFor(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
	registrationId: string,
) {
	requirePermission(ctx, { participant: ['read'] })
	await getEvent(db, ctx, eventId)
	const event = (await rankingEvent(db, eventId)) as RankingEvent
	const [registration] = await db
		.select({ id: schema.registration.id })
		.from(schema.registration)
		.where(
			and(eq(schema.registration.id, registrationId), eq(schema.registration.eventId, eventId)),
		)
		.limit(1)
	if (!registration) throw notFound('Registration')
	const [ranking, rankable] = await Promise.all([
		getPreferences(db, registrationId),
		rankableWorkshopIds(db, eventId, registrationId),
	])
	return {
		ranking,
		rankable: [...rankable],
		rules: {
			min: minimumRanks(event, rankable.size),
			max: Math.min(event.rankLimit, rankable.size),
		},
	}
}

/** A registration's ranking, most wanted first. */
export async function getPreferences(db: Db, registrationId: string): Promise<string[]> {
	const rows = await db
		.select({ workshopId: schema.preference.workshopId })
		.from(schema.preference)
		.where(eq(schema.preference.registrationId, registrationId))
		.orderBy(asc(schema.preference.rank))
	return rows.map((r) => r.workshopId)
}

/** How many active registrations have ranked, for the organizer's overview. */
export async function rankingProgress(db: Db, ctx: OrganizerContext, eventId: string) {
	await getEvent(db, ctx, eventId)
	const [registrations, ranked] = await Promise.all([
		db
			.select({ n: count() })
			.from(schema.registration)
			.where(
				and(eq(schema.registration.eventId, eventId), eq(schema.registration.status, 'active')),
			),
		db
			.select({ n: count() })
			.from(schema.registration)
			.where(
				and(
					eq(schema.registration.eventId, eventId),
					eq(schema.registration.status, 'active'),
					isNotNull(schema.registration.preferencesSubmittedAt),
				),
			),
	])
	return { registrations: registrations[0]?.n ?? 0, ranked: ranked[0]?.n ?? 0 }
}

/**
 * What a participant sees about their own published allocation (D9): the
 * trace entries for them only, when the event allows explanations.
 */
export async function participantExplanation(
	db: Db,
	storage: { get<T>(key: string): Promise<T | null> },
	context: ParticipantContext,
) {
	const [run] = await db
		.select({ resultKey: schema.allocationRun.resultKey, show: schema.event.showExplanations })
		.from(schema.allocationRun)
		.innerJoin(schema.event, eq(schema.event.id, schema.allocationRun.eventId))
		.where(
			and(
				eq(schema.allocationRun.eventId, context.eventId),
				eq(schema.allocationRun.status, 'published'),
			),
		)
		.limit(1)
	if (!run?.show) return null
	const result = await storage.get<{ traces: Record<string, unknown[]> }>(run.resultKey)
	return (result?.traces[context.registrationId] ?? []) as TraceEntry[]
}

/** Whether the event has published results (participants see their programme instead of the ranking). */
export async function hasPublishedRun(db: Db, eventId: string): Promise<boolean> {
	const [run] = await db
		.select({ id: schema.allocationRun.id })
		.from(schema.allocationRun)
		.where(
			and(eq(schema.allocationRun.eventId, eventId), eq(schema.allocationRun.status, 'published')),
		)
		.limit(1)
	return Boolean(run)
}
