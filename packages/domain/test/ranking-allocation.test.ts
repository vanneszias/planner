import { schema, uuidv7 } from '@app/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
	claimEmails,
	createDraftRun,
	createEvent,
	createSessions,
	createWorkshop,
	fillEmptyPlaces,
	getPreferences,
	importMinors,
	issueCredentials,
	listSessions,
	moveInRun,
	type ParticipantContext,
	participantExplanation,
	publishPreview,
	publishRun,
	type RunStorage,
	registerSelf,
	reviewRun,
	saveAgeGroups,
	savePreferences,
	setEventStatus,
	setPreferencesFor,
	updateEvent,
	updateWorkshop,
} from '../src/index.ts'
import { db, seedOrganization, summerCamp } from './fixtures.ts'

/** R2 stand-in: same interface, JSON round trip like the real thing. */
function memoryStorage(): RunStorage {
	const objects = new Map<string, string>()
	return {
		put: async (key, value) => void objects.set(key, JSON.stringify(value)),
		get: async (key) => (objects.has(key) ? JSON.parse(objects.get(key) as string) : null),
	}
}

/** A published ranking event: three workshops, one session each at different times, 2 seats by default. */
async function rankingEvent(capacity = 2) {
	const ctx = await seedOrganization()
	const event = await createEvent(db, ctx, {
		...summerCamp,
		mode: 'ranking',
		sessionsPerParticipant: 2,
	})
	await updateEvent(db, ctx, event.id, { rankMinimum: 2 })
	const times = [
		['10:00', '11:00'],
		['12:00', '13:00'],
		['14:00', '15:00'],
	]
	const workshops = []
	for (const [i, title] of ['Climbing', 'Printing', 'Podcast'].entries()) {
		const workshop = await createWorkshop(db, ctx, event.id, { title })
		const [start, end] = times[i] as [string, string]
		await createSessions(db, ctx, event.id, {
			workshopId: workshop.id,
			capacity,
			slots: [{ date: '2027-07-12', start, end }],
		})
		workshops.push(workshop)
	}
	await setEventStatus(db, ctx, event.id, 'published')
	const sessions = await listSessions(db, ctx, event.id)
	const sessionOf = (workshopId: string) =>
		sessions.find((s) => s.workshopId === workshopId)?.id as string
	return { ctx, event, workshops, sessionOf }
}

async function person(eventId: string): Promise<ParticipantContext> {
	const result = await registerSelf(db, eventId, { name: 'P', email: `${uuidv7()}@example.com` })
	if (result.kind !== 'created') throw new Error('expected created')
	return result.context
}

describe('rankings', () => {
	it('checks the minimum, the limit, duplicates and eligibility', async () => {
		const { ctx, event, workshops } = await rankingEvent()
		const [a, b, c] = workshops.map((w) => w.id) as [string, string, string]
		const me = await person(event.id)

		expect(await savePreferences(db, me, [a])).toEqual({ ok: false, reason: 'too_few' })
		expect(await savePreferences(db, me, [a, a])).toEqual({ ok: false, reason: 'duplicate' })
		await updateEvent(db, ctx, event.id, { rankLimit: 2 })
		expect(await savePreferences(db, me, [a, b, c])).toEqual({ ok: false, reason: 'too_many' })
		expect(await savePreferences(db, me, [b, a])).toEqual({ ok: true })
		expect(await getPreferences(db, me.registrationId)).toEqual([b, a])

		const [, older] = await saveAgeGroups(db, ctx, event.id, [
			{ label: 'young' },
			{ label: 'older' },
		])
		await updateWorkshop(db, ctx, c, { ageGroupIds: [older?.id as string] })
		expect(await savePreferences(db, me, [c, a])).toEqual({ ok: false, reason: 'not_eligible' })
	})

	it('keeps the first submission time when someone edits their ranking', async () => {
		const { event, workshops } = await rankingEvent()
		const [a, b] = workshops.map((w) => w.id) as [string, string]
		const me = await person(event.id)
		await savePreferences(db, me, [a, b])
		const read = async () =>
			(
				await db
					.select({ at: schema.registration.preferencesSubmittedAt })
					.from(schema.registration)
					.where(eq(schema.registration.id, me.registrationId))
			)[0]?.at?.getTime()
		const first = await read()
		await new Promise((resolve) => setTimeout(resolve, 5))
		await savePreferences(db, me, [b, a])
		expect(await read()).toBe(first)
	})

	it('refuses rankings in booking mode, but organizers can enter them for minors', async () => {
		const { ctx, event, workshops } = await rankingEvent()
		const [a, b] = workshops.map((w) => w.id) as [string, string]
		const me = await person(event.id)
		await updateEvent(db, ctx, event.id, {
			closes: { date: '2020-01-01', time: '10:00' },
			opens: null,
		})
		expect(await savePreferences(db, me, [a, b])).toEqual({ ok: false, reason: 'closed' })
		expect(await setPreferencesFor(db, ctx, event.id, me.registrationId, [a, b])).toEqual({
			ok: true,
		})
	})
})

describe('allocation runs', () => {
	it('drafts, reviews, accepts valid moves, fills, publishes and republishes', async () => {
		const { ctx, event, workshops, sessionOf } = await rankingEvent()
		const [a, b, c] = workshops.map((w) => w.id) as [string, string, string]
		const storage = memoryStorage()
		const people = await Promise.all(Array.from({ length: 4 }, () => person(event.id)))
		// Everyone wants Climbing then Printing: Climbing has 2 seats for 4 people.
		for (const p of people) expect(await savePreferences(db, p, [a, b])).toEqual({ ok: true })

		const draft = await createDraftRun(db, storage, ctx, event.id, { seed: 'fixed' })
		const review = await reviewRun(db, storage, ctx, draft.id)
		expect(review.metrics).toMatchObject({
			participants: 4,
			ranked: 4,
			firstChoice: 2,
			emptyPlaces: 4,
		})
		expect(review.sessionsTaken[sessionOf(a)]).toBe(2)

		// Moving someone into full Climbing is refused; into Podcast is fine.
		const withEmpty = review.people.find(
			(p) => p.empty > 0 && !p.sessions.some((s) => s.workshopId === a),
		) as (typeof review.people)[number]
		await expect(
			moveInRun(db, storage, ctx, draft.id, {
				registrationId: withEmpty.registrationId,
				toSessionId: sessionOf(a),
			}),
		).rejects.toMatchObject({ code: 'invalid', issues: { toSessionId: 'full' } })
		await moveInRun(db, storage, ctx, draft.id, {
			registrationId: withEmpty.registrationId,
			toSessionId: sessionOf(c),
		})
		expect((await reviewRun(db, storage, ctx, draft.id)).metrics).toMatchObject({
			emptyPlaces: 3,
			manualChanges: 1,
		})

		// "Fill all empty places" keeps the move and fills what it can (D27).
		const filled = await fillEmptyPlaces(db, storage, ctx, draft.id)
		// Only Podcast has a seat left (6 seats for 8 places), so 2 stay empty.
		expect((await reviewRun(db, storage, ctx, filled.id)).metrics.emptyPlaces).toBe(2)
		const [old] = await db
			.select()
			.from(schema.allocationRun)
			.where(eq(schema.allocationRun.id, draft.id))
		expect(old?.status).toBe('superseded')

		expect(await publishPreview(db, storage, ctx, filled.id)).toEqual({
			firstPublish: true,
			peopleChanging: 4,
		})
		const published = await publishRun(db, storage, ctx, filled.id)
		expect(published.registrationIds).toHaveLength(4)
		const rows = await db
			.select()
			.from(schema.assignment)
			.where(
				and(eq(schema.assignment.eventId, event.id), eq(schema.assignment.source, 'allocation')),
			)
		expect(rows).toHaveLength(6)

		// A second run replaces the first publish; nothing moves with the same data and seed.
		const again = await fillEmptyPlaces(db, storage, ctx, filled.id)
		expect(await publishPreview(db, storage, ctx, again.id)).toEqual({
			firstPublish: false,
			peopleChanging: 0,
		})
		await publishRun(db, storage, ctx, again.id)
		const statuses = await db
			.select({ id: schema.allocationRun.id, status: schema.allocationRun.status })
			.from(schema.allocationRun)
			.where(eq(schema.allocationRun.eventId, event.id))
		expect(statuses.filter((s) => s.status === 'published').map((s) => s.id)).toEqual([again.id])

		// Participants see why they got their places only when the event allows it (D9).
		const me = people[0] as ParticipantContext
		await updateEvent(db, ctx, event.id, { showExplanations: false })
		expect(await participantExplanation(db, storage, me)).toBeNull()
		await updateEvent(db, ctx, event.id, { showExplanations: true })
		expect((await participantExplanation(db, storage, me))?.length).toBeGreaterThan(0)
	})

	it('lets D1 enforce one published run per event (partial unique index)', async () => {
		const { ctx, event } = await rankingEvent()
		const row = (id: string) => ({
			id,
			organizationId: ctx.organizationId,
			eventId: event.id,
			status: 'published' as const,
			strategy: 'take-turns' as const,
			fillUnassigned: 'none' as const,
			seed: 's',
			engineVersion: '1',
			inputHash: 'h',
			inputKey: 'k',
			resultKey: 'r',
			metrics: {},
		})
		await db.insert(schema.allocationRun).values(row(uuidv7()))
		await expect(db.insert(schema.allocationRun).values(row(uuidv7()))).rejects.toThrow()
		// Drafts are not limited.
		await db.insert(schema.allocationRun).values({ ...row(uuidv7()), status: 'draft' })
		await db.insert(schema.allocationRun).values({ ...row(uuidv7()), status: 'draft' })
	})
})

describe('D1 limits at event size', () => {
	// D1 binds at most 100 values per statement; these used to fail above ~11 people.
	it('publishes, issues credentials and claims emails for 150 people', async () => {
		const { ctx, event, workshops } = await rankingEvent(150)
		const [a, b] = workshops.map((w) => w.id) as [string, string]
		const storage = memoryStorage()
		const people = []
		for (let i = 0; i < 150; i++) people.push(await person(event.id))
		for (const p of people) await savePreferences(db, p, [a, b])

		const draft = await createDraftRun(db, storage, ctx, event.id, { seed: 'fixed' })
		const published = await publishRun(db, storage, ctx, draft.id)
		expect(published.registrationIds).toHaveLength(150)
		const rows = await db
			.select({ id: schema.assignment.id })
			.from(schema.assignment)
			.where(eq(schema.assignment.eventId, event.id))
		expect(rows).toHaveLength(300)

		const claims = people.map((p) => ({
			organizationId: ctx.organizationId,
			eventId: event.id,
			registrationId: p.registrationId,
			kind: 'test',
			key: `test:${p.registrationId}`,
		}))
		expect((await claimEmails(db, claims)).size).toBe(150)
		expect((await claimEmails(db, claims)).size).toBe(0)

		const csv = ['name', ...Array.from({ length: 150 }, (_, i) => `Minor ${i}`)].join('\n')
		expect((await importMinors(db, ctx, event.id, csv, true)).imported).toBe(150)
		const issued = await issueCredentials(
			db,
			ctx,
			event.id,
			people.map((p) => p.registrationId),
		)
		expect(issued).toHaveLength(150)
	})
})
