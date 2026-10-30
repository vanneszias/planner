import { schema } from '@app/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
	addMinor,
	contextFromCode,
	contextFromToken,
	createEvent,
	importMinors,
	issueCredentials,
	listParticipants,
	saveAgeGroups,
} from '../src/index.ts'
import { addMember, db, seedOrganization, summerCamp } from './fixtures.ts'

describe('organizer participant management', () => {
	it('lets viewers read (audit-logged) but not add, and keeps other organizations out', async () => {
		const owner = await seedOrganization()
		const viewer = await addMember(owner.organizationId, 'viewer')
		const other = await seedOrganization()
		const event = await createEvent(db, owner, summerCamp)
		await addMinor(db, owner, event.id, { name: 'Noor' })

		expect((await listParticipants(db, viewer, event.id)).map((p) => p.displayName)).toEqual([
			'Noor',
		])
		const logged = await db
			.select()
			.from(schema.auditLog)
			.where(
				and(
					eq(schema.auditLog.actorUserId, viewer.userId),
					eq(schema.auditLog.action, 'participants.list'),
				),
			)
		expect(logged).toHaveLength(1)

		await expect(addMinor(db, viewer, event.id, { name: 'X' })).rejects.toMatchObject({
			code: 'forbidden',
		})
		await expect(listParticipants(db, other, event.id)).rejects.toMatchObject({ code: 'not_found' })
	})

	it('imports nothing until every row is valid', async () => {
		const ctx = await seedOrganization()
		const event = await createEvent(db, ctx, summerCamp)
		await saveAgeGroups(db, ctx, event.id, [{ label: '12–14' }, { label: '15–18' }])
		const bad =
			'name;age group;guardian email\nNoor;12–14;ouder@example.com\n;15–18;\nLars;kids;not-an-email\n'
		const checked = await importMinors(db, ctx, event.id, bad, true)
		expect(checked.imported).toBe(0)
		expect(checked.problems).toEqual([
			{ row: 3, field: 'name', code: 'required' },
			{ row: 4, field: 'age group', code: 'not_found' },
			{ row: 4, field: 'guardianEmail', code: 'email' },
		])
		expect(await listParticipants(db, ctx, event.id)).toEqual([])

		const good = 'Name,Age group,Guardian email\nNoor,12–14,Ouder@Example.com\nLars,15–18,\n'
		expect((await importMinors(db, ctx, event.id, good, false)).problems).toEqual([])
		expect((await importMinors(db, ctx, event.id, good, true)).imported).toBe(2)
		const people = await listParticipants(db, ctx, event.id)
		expect(people.map((p) => [p.displayName, p.guardianEmail, p.isMinor])).toEqual([
			['Lars', null, true],
			['Noor', 'ouder@example.com', true],
		])
	})

	it('issues fresh links and codes that work, and revokes the old ones', async () => {
		const ctx = await seedOrganization()
		const event = await createEvent(db, ctx, summerCamp)
		const id = (await addMinor(db, ctx, event.id, { name: 'Noor' })) as string

		const [first] = await issueCredentials(db, ctx, event.id, [id])
		expect(await contextFromToken(db, first?.token as string)).toMatchObject({ registrationId: id })
		expect(await contextFromCode(db, event.id, first?.code as string)).toMatchObject({
			registrationId: id,
		})

		const [second] = await issueCredentials(db, ctx, event.id, [id])
		expect(await contextFromToken(db, first?.token as string)).toBeNull()
		expect(await contextFromCode(db, event.id, first?.code as string)).toBeNull()
		expect(await contextFromToken(db, second?.token as string)).toMatchObject({
			registrationId: id,
		})
	})
})
