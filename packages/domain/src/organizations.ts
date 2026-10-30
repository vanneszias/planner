import { type Db, schema, uuidv7 } from '@app/db'
import { asc, eq } from 'drizzle-orm'
import { reservedSlugs, slugify, uniqueSlug } from './slug.ts'

/** A slug for an organization: not reserved by the app, not used by another organization. */
export async function organizationSlug(db: Db, name: string): Promise<string> {
	const base = slugify(name) || 'organization'
	return uniqueSlug(reservedSlugs.has(base) ? `${base}-org` : base, async (candidate) => {
		if (reservedSlugs.has(candidate)) return true
		const [row] = await db
			.select({ id: schema.organization.id })
			.from(schema.organization)
			.where(eq(schema.organization.slug, candidate))
			.limit(1)
		return Boolean(row)
	})
}

/**
 * Every new organizer gets a personal organization they own, named after them
 * and renamable later (journeys.md, O1).
 */
export async function createPersonalOrganization(
	db: Db,
	user: { id: string; name: string; email: string },
): Promise<string> {
	const organizationId = uuidv7()
	const now = new Date()
	// Magic-link sign-ups have no name yet; fall back to the email's local part.
	const name = user.name.trim() || user.email.split('@')[0] || 'My organization'
	await db.batch([
		db.insert(schema.organization).values({
			id: organizationId,
			name,
			slug: await organizationSlug(db, name),
			createdAt: now,
		}),
		db.insert(schema.member).values({
			id: uuidv7(),
			organizationId,
			userId: user.id,
			role: 'owner',
			createdAt: now,
		}),
	])
	return organizationId
}

/** The organization a user works in when the session has none set: their oldest membership. */
export async function defaultOrganizationId(db: Db, userId: string): Promise<string | null> {
	const [membership] = await db
		.select({ organizationId: schema.member.organizationId })
		.from(schema.member)
		.where(eq(schema.member.userId, userId))
		.orderBy(asc(schema.member.createdAt))
		.limit(1)
	return membership?.organizationId ?? null
}

export async function getOrganization(db: Db, organizationId: string) {
	const [found] = await db
		.select({
			id: schema.organization.id,
			name: schema.organization.name,
			slug: schema.organization.slug,
		})
		.from(schema.organization)
		.where(eq(schema.organization.id, organizationId))
		.limit(1)
	return found ?? null
}
