import { schema, uuidv7 } from '@app/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
	addMinor,
	createEvent,
	importTokenKey,
	issueCredentials,
	linkRegistrations,
	openWith,
	passesFor,
	registerSelf,
	sealWith,
	setEventStatus,
} from '../src/index.ts'
import { db, seedOrganization, summerCamp } from './fixtures.ts'

const keyText = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
const key = await importTokenKey(keyText)
const seal = (token: string) => sealWith(key, token)
const open = (sealed: string) => openWith(key, sealed)

/** A user with the given email; verified or not. */
async function account(email: string, emailVerified = true) {
	const id = uuidv7()
	const now = new Date()
	await db
		.insert(schema.user)
		.values({ id, name: 'Account', email, emailVerified, createdAt: now, updatedAt: now })
	return { id, email, emailVerified }
}

async function publishedEvent() {
	const owner = await seedOrganization()
	const event = await createEvent(db, owner, summerCamp)
	await setEventStatus(db, owner, event.id, 'published')
	return { owner, event }
}

describe('participant accounts and passes', () => {
	it('shows a self-registration pass to the verified owner of that email', async () => {
		const { event } = await publishedEvent()
		const email = `${uuidv7()}@example.com`
		const result = await registerSelf(db, event.id, { name: 'Ana', email }, seal)
		if (result.kind !== 'created') throw new Error('expected a new registration')

		const user = await account(email.toUpperCase())
		await linkRegistrations(db, user)
		const passes = await passesFor(db, user.id, open)
		expect(passes).toHaveLength(1)
		expect(passes[0]).toMatchObject({ eventId: event.id, displayName: 'Ana', forChild: false })
		expect(passes[0]?.token).toBe(result.credentials.token)
	})

	it('does not attach registrations to an unverified email', async () => {
		const { event } = await publishedEvent()
		const email = `${uuidv7()}@example.com`
		await registerSelf(db, event.id, { name: 'Ana', email }, seal)

		const user = await account(email, false)
		await linkRegistrations(db, user)
		expect(await passesFor(db, user.id, open)).toEqual([])
	})

	it('shows a child pass to the guardian with the matching verified email', async () => {
		const { owner, event } = await publishedEvent()
		const guardianEmail = `${uuidv7()}@example.com`
		const childId = await addMinor(db, owner, event.id, {
			name: 'Noor Janssens',
			guardianEmail,
		})
		const [issued] = await issueCredentials(db, owner, event.id, [childId as string], seal)
		if (!issued) throw new Error('expected a card')

		const guardian = await account(guardianEmail)
		await linkRegistrations(db, guardian)
		const passes = await passesFor(db, guardian.id, open, event.id)
		expect(passes).toHaveLength(1)
		expect(passes[0]).toMatchObject({ displayName: 'Noor Janssens', forChild: true })
		expect(passes[0]?.token).toBe(issued.token)
	})

	it('drops the old pass once codes are issued again, and keeps only the newest token', async () => {
		const { owner, event } = await publishedEvent()
		const id = (await addMinor(db, owner, event.id, { name: 'Sam' })) as string
		await issueCredentials(db, owner, event.id, [id], seal)
		const [second] = await issueCredentials(db, owner, event.id, [id], seal)
		if (!second) throw new Error('expected a card')

		const guardian = await account(`${uuidv7()}@example.com`)
		await db
			.update(schema.registration)
			.set({ managedByUserId: guardian.id })
			.where(eq(schema.registration.id, id))
		const passes = await passesFor(db, guardian.id, open)
		expect(passes.map((p) => p.token)).toEqual([second.token])
	})

	it('returns no pass for credentials issued before passes existed', async () => {
		const { event } = await publishedEvent()
		const email = `${uuidv7()}@example.com`
		await registerSelf(db, event.id, { name: 'Old', email }) // no sealer: pre-pass credentials
		const user = await account(email)
		await linkRegistrations(db, user)
		expect(await passesFor(db, user.id, open)).toEqual([])
	})

	it('cannot open a sealed token with another key', async () => {
		const other = await importTokenKey(btoa(String.fromCharCode(...new Uint8Array(32).fill(9))))
		const sealed = await sealWith(key, 'secret-token')
		expect(await openWith(other, sealed)).toBeNull()
		expect(await openWith(key, sealed)).toBe('secret-token')
	})

	it('rejects a key that is not 32 bytes', async () => {
		await expect(importTokenKey(btoa('too short'))).rejects.toThrow(/32 bytes/)
	})
})
