import { env } from 'cloudflare:workers'
import { createDb, schema, uuidv7 } from '@app/db'
import {
	createEvent,
	createSessions,
	createWorkshop,
	listSessions,
	type OrganizerContext,
	type ParticipantContext,
	registerSelf,
	setEventStatus,
} from '@app/domain'
import { describe, expect, it } from 'vitest'

const db = createDb(env.DB)

async function publishedSession(capacity: number) {
	const now = new Date()
	const ctx: OrganizerContext = { userId: uuidv7(), organizationId: uuidv7(), role: 'owner' }
	await db.batch([
		db.insert(schema.user).values({
			id: ctx.userId,
			name: 'Owner',
			email: `${ctx.userId}@example.com`,
			createdAt: now,
			updatedAt: now,
		}),
		db.insert(schema.organization).values({
			id: ctx.organizationId,
			name: 'Org',
			slug: `org-${ctx.organizationId}`,
			createdAt: now,
		}),
		db.insert(schema.member).values({
			id: uuidv7(),
			organizationId: ctx.organizationId,
			userId: ctx.userId,
			role: 'owner',
			createdAt: now,
		}),
	])
	const event = await createEvent(db, ctx, {
		name: 'Camp',
		startsOn: '2027-07-12',
		endsOn: '2027-07-12',
		timezone: 'Europe/Brussels',
		mode: 'booking',
		defaultLocale: 'en',
		sessionsPerParticipant: 2,
	})
	const workshop = await createWorkshop(db, ctx, event.id, { title: 'Climbing' })
	await createSessions(db, ctx, event.id, {
		workshopId: workshop.id,
		capacity,
		slots: [{ date: '2027-07-12', start: '10:00', end: '11:00' }],
	})
	await setEventStatus(db, ctx, event.id, 'published')
	const [session] = await listSessions(db, ctx, event.id)
	return { eventId: event.id, sessionId: session?.id as string }
}

async function people(eventId: string, count: number): Promise<ParticipantContext[]> {
	return Promise.all(
		Array.from({ length: count }, async (_, i) => {
			const result = await registerSelf(db, eventId, {
				name: `P${i}`,
				email: `p${i}-${uuidv7()}@example.com`,
			})
			if (result.kind !== 'created') throw new Error('expected created')
			return result.context
		}),
	)
}

const coordinator = (eventId: string) =>
	env.EVENT_COORDINATOR.get(env.EVENT_COORDINATOR.idFromName(eventId))

describe('EventCoordinator bookings', () => {
	it('never overbooks when 200 people book through the object at once', async () => {
		const { eventId, sessionId } = await publishedSession(10)
		const participants = await people(eventId, 200)
		const stub = coordinator(eventId)
		const results = await Promise.all(participants.map((p) => stub.book(p, sessionId)))
		expect(results.filter((r) => r.ok)).toHaveLength(10)
		const rows = await db.select().from(schema.assignment)
		expect(rows.filter((r) => r.sessionId === sessionId)).toHaveLength(10)
	})

	it('pushes seat counts to connected browsers after a booking', async () => {
		const { eventId, sessionId } = await publishedSession(5)
		const [ana] = await people(eventId, 1)
		const stub = coordinator(eventId)
		const response = await stub.fetch('https://coordinator/live', {
			headers: { Upgrade: 'websocket' },
		})
		const socket = response.webSocket
		if (!socket) throw new Error('No WebSocket')
		socket.accept()
		const message = new Promise<string>((resolve) =>
			socket.addEventListener('message', (event) => resolve(String(event.data))),
		)
		await stub.book(ana as ParticipantContext, sessionId)
		expect(JSON.parse(await message)).toEqual({ type: 'seats', seats: { [sessionId]: 1 } })
		socket.close()
	})

	it('promotes from the waitlist on cancellation and reports who moved up', async () => {
		const { eventId, sessionId } = await publishedSession(1)
		const [ana, bo] = (await people(eventId, 2)) as [ParticipantContext, ParticipantContext]
		const stub = coordinator(eventId)
		expect(await stub.book(ana, sessionId)).toEqual({ ok: true })
		expect(await stub.joinWaitlist(bo, sessionId)).toEqual({ ok: true, position: 1 })
		expect(await stub.cancel(ana, sessionId)).toEqual({
			ok: true,
			promoted: { registrationId: bo.registrationId, sessionId },
		})
	})
})
