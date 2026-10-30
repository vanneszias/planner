import { beforeAll, describe, expect, it } from 'vitest'
import {
	createEvent,
	createSessions,
	createWorkshop,
	deleteEvent,
	deleteSession,
	deleteWorkshop,
	getEvent,
	listEvents,
	listSessions,
	listWorkshops,
	type OrganizerContext,
	organizerContext,
	setEventStatus,
	updateEvent,
	updateSession,
	updateWorkshop,
} from '../src/index.ts'
import { db, seedOrganization, summerCamp } from './fixtures.ts'

/*
 * The main defence against cross-tenant leaks (docs/security-privacy.md):
 * organization B tries every read and write on organization A's records and
 * must see nothing and change nothing. Records in another organization look
 * exactly like records that don't exist.
 */
describe('tenant isolation', () => {
	let a: OrganizerContext
	let b: OrganizerContext
	let eventId: string
	let workshopId: string
	let sessionId: string

	beforeAll(async () => {
		a = await seedOrganization('owner')
		b = await seedOrganization('owner')
		eventId = (await createEvent(db, a, summerCamp)).id
		workshopId = (await createWorkshop(db, a, eventId, { title: 'Climbing' })).id
		;[sessionId] = (await createSessions(db, a, eventId, {
			workshopId,
			room: 'Hall B',
			capacity: 12,
			slots: [{ date: '2027-07-12', start: '10:00', end: '11:15' }],
		})) as [string]
	})

	const expectNotFound = (promise: Promise<unknown>) =>
		expect(promise).rejects.toMatchObject({ code: 'not_found' })

	it("doesn't list another organization's events, workshops or sessions", async () => {
		expect(await listEvents(db, b)).toEqual([])
		expect(await listWorkshops(db, b, eventId)).toEqual([])
		expect(await listSessions(db, b, eventId)).toEqual([])
	})

	it("can't read another organization's event", async () => {
		await expectNotFound(getEvent(db, b, eventId))
	})

	it("can't change or delete another organization's event", async () => {
		await expectNotFound(updateEvent(db, b, eventId, { name: 'Hijacked' }))
		await expectNotFound(setEventStatus(db, b, eventId, 'published'))
		await expectNotFound(deleteEvent(db, b, eventId))
	})

	it("can't add workshops or sessions to another organization's event", async () => {
		await expectNotFound(createWorkshop(db, b, eventId, { title: 'Intruder' }))
		await expectNotFound(
			createSessions(db, b, eventId, {
				workshopId,
				capacity: 5,
				slots: [{ date: '2027-07-12', start: '12:00', end: '13:00' }],
			}),
		)
	})

	it("can't change or delete another organization's workshops and sessions", async () => {
		await expectNotFound(updateWorkshop(db, b, workshopId, { title: 'Hijacked' }))
		await expectNotFound(deleteWorkshop(db, b, workshopId))
		await expectNotFound(updateSession(db, b, sessionId, { capacity: 999 }))
		await expectNotFound(deleteSession(db, b, sessionId))
	})

	it("can't use its own event to reach another organization's workshop", async () => {
		const own = await createEvent(db, b, summerCamp)
		await expect(
			createSessions(db, b, own.id, {
				workshopId,
				capacity: 5,
				slots: [{ date: '2027-07-12', start: '12:00', end: '13:00' }],
			}),
		).rejects.toMatchObject({ code: 'invalid', issues: { workshopId: 'not_found' } })
	})

	it("leaves organization A's data untouched", async () => {
		const event = await getEvent(db, a, eventId)
		expect(event.name).toBe(summerCamp.name)
		expect(event.status).toBe('draft')
		const [workshop] = await listWorkshops(db, a, eventId)
		expect(workshop?.title).toBe('Climbing')
		const [session] = await listSessions(db, a, eventId)
		expect(session?.capacity).toBe(12)
	})

	it('gives non-members no context at all', async () => {
		expect(await organizerContext(db, b.userId, a.organizationId)).toBeNull()
		expect(await organizerContext(db, a.userId, a.organizationId)).toMatchObject({ role: 'owner' })
	})
})
