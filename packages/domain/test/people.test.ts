import { schema, uuidv7 } from '@app/db'
import { describe, expect, it } from 'vitest'
import {
	invitationFor,
	listMembers,
	listPendingInvitations,
	listUserOrganizations,
} from '../src/index.ts'
import { addMember, db, seedOrganization } from './fixtures.ts'

async function invite(organizationId: string, inviterId: string, email: string, expiresInDays = 7) {
	const id = uuidv7()
	await db.insert(schema.invitation).values({
		id,
		organizationId,
		inviterId,
		email,
		role: 'editor',
		status: 'pending',
		expiresAt: new Date(Date.now() + expiresInDays * 86_400_000),
	})
	return id
}

describe('people', () => {
	it('lists members and invitations of the own organization only', async () => {
		const a = await seedOrganization('owner')
		const b = await seedOrganization('owner')
		await addMember(a.organizationId, 'viewer')
		await invite(a.organizationId, a.userId, 'new@example.com')

		expect(await listMembers(db, a)).toHaveLength(2)
		expect(await listPendingInvitations(db, a)).toHaveLength(1)
		expect(await listMembers(db, b)).toHaveLength(1)
		expect(await listPendingInvitations(db, b)).toEqual([])
	})

	it('hides expired invitations', async () => {
		const a = await seedOrganization('owner')
		await invite(a.organizationId, a.userId, 'late@example.com', -1)
		expect(await listPendingInvitations(db, a)).toEqual([])
	})

	it('shows an invitation only to the person it was sent to', async () => {
		const a = await seedOrganization('owner', `scouts-${uuidv7()}`)
		const id = await invite(a.organizationId, a.userId, 'Invitee@Example.com')

		expect(await invitationFor(db, id, 'invitee@example.com')).toMatchObject({
			state: 'open',
			organizationName: a.slug,
		})
		const other = await invitationFor(db, id, 'someone-else@example.com')
		expect(other).toEqual({ state: 'other_email', email: 'Invitee@Example.com' })
		expect(other).not.toHaveProperty('organizationName')
		expect(await invitationFor(db, uuidv7(), 'invitee@example.com')).toEqual({ state: 'missing' })
	})

	it("lists a user's organizations for the switcher", async () => {
		const a = await seedOrganization('owner')
		const b = await seedOrganization('owner')
		await db.insert(schema.member).values({
			id: uuidv7(),
			organizationId: b.organizationId,
			userId: a.userId,
			role: 'viewer',
			createdAt: new Date(),
		})
		const organizations = await listUserOrganizations(db, a.userId)
		expect(organizations.map((o) => o.role).sort()).toEqual(['owner', 'viewer'])
	})
})
