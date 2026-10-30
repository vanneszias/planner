import { env } from 'cloudflare:workers'
import type { Role } from '@app/auth/permissions'
import { createDb, schema, uuidv7 } from '@app/db'
import type { OrganizerContext } from '../src/index.ts'

export const db = createDb(env.DB)

/** A fresh organization with one member of the given role. */
export async function seedOrganization(role: Role = 'owner', slug = `org-${uuidv7()}`) {
	const now = new Date()
	const userId = uuidv7()
	const organizationId = uuidv7()
	await db.batch([
		db.insert(schema.user).values({
			id: userId,
			name: 'Test',
			email: `${userId}@example.com`,
			createdAt: now,
			updatedAt: now,
		}),
		db.insert(schema.organization).values({ id: organizationId, name: slug, slug, createdAt: now }),
		db.insert(schema.member).values({
			id: uuidv7(),
			organizationId,
			userId,
			role,
			createdAt: now,
		}),
	])
	return { userId, organizationId, role, slug } satisfies OrganizerContext & { slug: string }
}

/** Adds another member with a different role to an existing organization. */
export async function addMember(organizationId: string, role: Role): Promise<OrganizerContext> {
	const now = new Date()
	const userId = uuidv7()
	await db.batch([
		db.insert(schema.user).values({
			id: userId,
			name: 'Member',
			email: `${userId}@example.com`,
			createdAt: now,
			updatedAt: now,
		}),
		db.insert(schema.member).values({ id: uuidv7(), organizationId, userId, role, createdAt: now }),
	])
	return { userId, organizationId, role }
}

export const summerCamp = {
	name: 'Zomerkamp 2027',
	startsOn: '2027-07-12',
	endsOn: '2027-07-13',
	timezone: 'Europe/Brussels',
	mode: 'booking',
	defaultLocale: 'nl',
	sessionsPerParticipant: 3,
} as const
