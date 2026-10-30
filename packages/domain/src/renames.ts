import { type Db, schema } from '@app/db'
import { and, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import { auditStatement } from './audit.ts'
import { type OrganizerContext, requirePermission } from './context.ts'
import { invalid, notFound } from './errors.ts'
import { getEvent } from './events.ts'
import { getOrganization } from './organizations.ts'
import { reservedSlugs, slugify } from './slug.ts'
import { parse } from './validation.ts'

/*
 * Renames that change public URLs. The old path goes into slug_redirect so
 * links and printed QR codes keep working (D19).
 */

const slugInput = z
	.string()
	.transform((value) => slugify(value))
	.pipe(z.string().min(1, 'required'))

export async function renameEventSlug(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
	input: string,
): Promise<string> {
	requirePermission(ctx, { event: ['update'] })
	const slug = parse(z.object({ slug: slugInput }), { slug: input }).slug
	const event = await getEvent(db, ctx, eventId)
	if (slug === event.slug) return slug

	const [taken] = await db
		.select({ id: schema.event.id })
		.from(schema.event)
		.where(
			and(
				eq(schema.event.organizationId, ctx.organizationId),
				eq(schema.event.slug, slug),
				ne(schema.event.id, eventId),
			),
		)
		.limit(1)
	if (taken) throw invalid({ slug: 'taken' })

	const organization = await getOrganization(db, ctx.organizationId)
	if (!organization) throw notFound('Organization')
	await db.batch([
		db
			.insert(schema.slugRedirect)
			.values({
				oldPath: `/${organization.slug}/${event.slug}`,
				organizationId: ctx.organizationId,
				eventId,
			})
			.onConflictDoUpdate({
				target: schema.slugRedirect.oldPath,
				set: { organizationId: ctx.organizationId, eventId },
			}),
		db
			.update(schema.event)
			.set({ slug })
			.where(
				and(eq(schema.event.id, eventId), eq(schema.event.organizationId, ctx.organizationId)),
			),
	])
	await auditStatement(db, ctx, {
		action: 'event.slug',
		subjectType: 'event',
		subjectId: eventId,
		eventId,
	})
	return slug
}

export const organizationInput = z.object({
	name: z.string().trim().min(1, 'required').max(120, 'too_long'),
	slug: slugInput,
})
export type OrganizationInput = z.input<typeof organizationInput>

/** Owners only (the `organization: update` permission). */
export async function updateOrganization(
	db: Db,
	ctx: OrganizerContext,
	input: OrganizationInput,
): Promise<{ name: string; slug: string }> {
	requirePermission(ctx, { organization: ['update'] })
	const values = parse(organizationInput, input)
	if (reservedSlugs.has(values.slug)) throw invalid({ slug: 'reserved' })
	const current = await getOrganization(db, ctx.organizationId)
	if (!current) throw notFound('Organization')

	if (values.slug !== current.slug) {
		const [taken] = await db
			.select({ id: schema.organization.id })
			.from(schema.organization)
			.where(eq(schema.organization.slug, values.slug))
			.limit(1)
		if (taken) throw invalid({ slug: 'taken' })
		await db
			.insert(schema.slugRedirect)
			.values({ oldPath: `/${current.slug}`, organizationId: ctx.organizationId })
			.onConflictDoUpdate({
				target: schema.slugRedirect.oldPath,
				set: { organizationId: ctx.organizationId, eventId: null },
			})
	}

	await db
		.update(schema.organization)
		.set(values)
		.where(eq(schema.organization.id, ctx.organizationId))
	await auditStatement(db, ctx, {
		action: 'organization.update',
		subjectType: 'organization',
		subjectId: ctx.organizationId,
		data: { fields: Object.keys(values) },
	})
	return values
}
