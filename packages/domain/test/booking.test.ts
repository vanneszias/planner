import { schema } from '@app/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
	bookSession,
	cancelBooking,
	cancelRegistration,
	contextFromCode,
	contextFromToken,
	createEvent,
	createSessions,
	createWorkshop,
	joinWaitlist,
	listSessions,
	normalizeShortCode,
	type ParticipantContext,
	participantPlan,
	registerSelf,
	rotateAccessToken,
	saveAgeGroups,
	seatCounts,
	setEventStatus,
	updateEvent,
	updateWorkshop,
} from '../src/index.ts'
import { db, seedOrganization, summerCamp } from './fixtures.ts'

/** A published booking event with three workshops; returns session ids by name. */
async function bookingEvent(capacity = 2) {
	const ctx = await seedOrganization()
	const event = await createEvent(db, ctx, { ...summerCamp, sessionsPerParticipant: 2 })
	const make = async (title: string, start: string, end: string, places = capacity) => {
		const workshop = await createWorkshop(db, ctx, event.id, { title })
		await createSessions(db, ctx, event.id, {
			workshopId: workshop.id,
			capacity: places,
			slots: [{ date: '2027-07-12', start, end }],
		})
		return workshop
	}
	const climbing = await make('Climbing', '10:00', '11:00')
	await make('Printing', '10:30', '11:30')
	await make('Podcast', '13:00', '14:00')
	await setEventStatus(db, ctx, event.id, 'published')
	const sessions = await listSessions(db, ctx, event.id)
	const id = (title: string) => sessions.find((s) => s.workshopTitle === title)?.id as string
	return {
		ctx,
		event,
		climbing,
		climb: id('Climbing'),
		print: id('Printing'),
		podcast: id('Podcast'),
	}
}

let n = 0
async function participant(eventId: string): Promise<ParticipantContext> {
	n++
	const result = await registerSelf(db, eventId, {
		name: `P${n}`,
		email: `p${n}-${Date.now()}@example.com`,
	})
	if (result.kind !== 'created') throw new Error('expected a new registration')
	return result.context
}

describe('booking', () => {
	it('books, refuses with the right reason, and counts seats', async () => {
		const { event, climb, print, podcast } = await bookingEvent(1)
		const ana = await participant(event.id)
		const bo = await participant(event.id)

		expect(await bookSession(db, ana, climb)).toEqual({ ok: true })
		expect(await bookSession(db, ana, climb)).toEqual({ ok: false, reason: 'already_booked' })
		expect(await bookSession(db, ana, print)).toEqual({ ok: false, reason: 'overlap' })
		expect(await bookSession(db, bo, climb)).toEqual({ ok: false, reason: 'full' })
		expect(await bookSession(db, ana, podcast)).toEqual({ ok: true })
		expect(await seatCounts(db, event.id)).toEqual({ [climb]: 1, [podcast]: 1 })
	})

	it('stops at the sessions-per-person limit', async () => {
		const { ctx, event, climb, podcast } = await bookingEvent(5)
		await updateEvent(db, ctx, event.id, { sessionsPerParticipant: 1 })
		const ana = await participant(event.id)
		expect(await bookSession(db, ana, climb)).toEqual({ ok: true })
		expect(await bookSession(db, ana, podcast)).toEqual({ ok: false, reason: 'limit' })
	})

	it('respects age groups, the booking window and ranking mode', async () => {
		const { ctx, event, climbing, climb } = await bookingEvent(5)
		const [, older] = await saveAgeGroups(db, ctx, event.id, [
			{ label: '12–14' },
			{ label: '15–18' },
		])
		await updateWorkshop(db, ctx, climbing.id, { ageGroupIds: [older?.id as string] })
		const ana = await participant(event.id)
		expect(await bookSession(db, ana, climb)).toEqual({ ok: false, reason: 'not_eligible' })

		await updateWorkshop(db, ctx, climbing.id, { ageGroupIds: [] })
		await updateEvent(db, ctx, event.id, { opens: { date: '2099-01-01', time: '10:00' } })
		expect(await bookSession(db, ana, climb)).toEqual({ ok: false, reason: 'closed' })
		await updateEvent(db, ctx, event.id, { opens: null, mode: 'ranking' })
		expect(await bookSession(db, ana, climb)).toEqual({ ok: false, reason: 'closed' })
	})

	it('promotes the first person on the waitlist when someone cancels', async () => {
		const { event, climb } = await bookingEvent(1)
		const ana = await participant(event.id)
		const bo = await participant(event.id)
		const cy = await participant(event.id)
		await bookSession(db, ana, climb)
		expect(await joinWaitlist(db, bo, climb)).toEqual({ ok: true, position: 1 })
		expect(await joinWaitlist(db, cy, climb)).toEqual({ ok: true, position: 2 })

		const cancelled = await cancelBooking(db, ana, climb)
		expect(cancelled).toEqual({
			ok: true,
			promoted: { registrationId: bo.registrationId, sessionId: climb },
		})
		expect((await participantPlan(db, bo)).bookings.map((b) => b.sessionId)).toEqual([climb])
		expect((await participantPlan(db, cy)).waitlist).toEqual([{ sessionId: climb, position: 1 }])
	})

	it('refuses cancellations after the cut-off (D22)', async () => {
		const { ctx, event, climb } = await bookingEvent(5)
		const ana = await participant(event.id)
		await bookSession(db, ana, climb)
		await updateEvent(db, ctx, event.id, { changeCutoff: 'session-start' })
		expect(await cancelBooking(db, ana, climb, new Date('2027-07-12T09:00:00Z'))).toEqual({
			ok: false,
			reason: 'too_late',
		})
		expect(await cancelBooking(db, ana, climb, new Date('2027-07-12T07:00:00Z'))).toMatchObject({
			ok: true,
		})
	})
})

describe('concurrency', () => {
	it('never overbooks when hundreds book one session at the same moment', async () => {
		const { event, climb } = await bookingEvent(10)
		const people = await Promise.all(Array.from({ length: 300 }, () => participant(event.id)))
		const results = await Promise.all(people.map((p) => bookSession(db, p, climb)))
		expect(results.filter((r) => r.ok)).toHaveLength(10)
		expect(results.filter((r) => !r.ok && r.reason === 'full')).toHaveLength(290)
		const rows = await db
			.select()
			.from(schema.assignment)
			.where(eq(schema.assignment.sessionId, climb))
		expect(rows).toHaveLength(10)
	})

	it('never double-books one person who clicks many times at once', async () => {
		const { event, climb } = await bookingEvent(10)
		const ana = await participant(event.id)
		const results = await Promise.all(Array.from({ length: 50 }, () => bookSession(db, ana, climb)))
		expect(results.filter((r) => r.ok)).toHaveLength(1)
		expect((await participantPlan(db, ana)).bookings).toHaveLength(1)
	})
})

describe('links and codes', () => {
	it('resolves the private link and the short code, forgiving typing', async () => {
		const { event } = await bookingEvent()
		const result = await registerSelf(db, event.id, {
			name: 'Noor',
			email: `noor-${Date.now()}@example.com`,
		})
		if (result.kind !== 'created') throw new Error('expected created')
		const { token, code } = result.credentials
		expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{2}$/)

		expect(await contextFromToken(db, token)).toEqual(result.context)
		expect(await contextFromCode(db, event.id, code.toLowerCase().replace('-', ' '))).toEqual(
			result.context,
		)
		const { event: otherEvent } = await bookingEvent()
		expect(await contextFromCode(db, otherEvent.id, code)).toBeNull()
		expect(normalizeShortCode('k7q2-xo')).toBe('K7Q2X0')
	})

	it('stops working after the link is rotated', async () => {
		const { event } = await bookingEvent()
		const result = await registerSelf(db, event.id, {
			name: 'Lars',
			email: `lars-${Date.now()}@example.com`,
		})
		if (result.kind !== 'created') throw new Error('expected created')
		const fresh = await rotateAccessToken(db, result.context.registrationId)
		expect(await contextFromToken(db, result.credentials.token)).toBeNull()
		expect(await contextFromToken(db, fresh)).toEqual(result.context)
	})

	it('does not create a second registration for the same email', async () => {
		const { event } = await bookingEvent()
		const email = `same-${Date.now()}@example.com`
		const first = await registerSelf(db, event.id, { name: 'A', email })
		const second = await registerSelf(db, event.id, { name: 'B', email: email.toUpperCase() })
		expect(second).toEqual({
			kind: 'existing',
			registrationId: first.kind === 'created' ? first.context.registrationId : '',
		})
	})

	it("can't register for an unpublished event", async () => {
		const ctx = await seedOrganization()
		const draft = await createEvent(db, ctx, summerCamp)
		await expect(
			registerSelf(db, draft.id, { name: 'X', email: 'x@example.com' }),
		).rejects.toMatchObject({ code: 'not_found' })
	})
})

describe('cancelling a registration', () => {
	it('frees places, promotes the waitlist, revokes the link and frees the email', async () => {
		const { event, climb } = await bookingEvent(1)
		const email = `cancel-${Date.now()}@example.com`
		const ana = await registerSelf(db, event.id, { name: 'Ana', email })
		if (ana.kind !== 'created') throw new Error('expected created')
		const bo = await participant(event.id)
		await bookSession(db, ana.context, climb)
		await joinWaitlist(db, bo, climb)

		expect(await cancelRegistration(db, ana.context)).toEqual([
			{ registrationId: bo.registrationId, sessionId: climb },
		])
		expect(await contextFromToken(db, ana.credentials.token)).toBeNull()
		expect((await registerSelf(db, event.id, { name: 'Ana', email })).kind).toBe('created')
	})
})
