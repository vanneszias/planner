import { type Db, schema } from '@app/db'
import { and, asc, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { assertAgeGroups, setWorkshopAgeGroups } from './age-groups.ts'
import { auditStatement } from './audit.ts'
import { type OrganizerContext, requirePermission } from './context.ts'
import { notFound } from './errors.ts'
import { getEvent } from './events.ts'
import { parse } from './validation.ts'

export const workshopInput = z.object({
	title: z.string().trim().min(1, 'required').max(120, 'too_long'),
	description: z.string().trim().max(2000, 'too_long').default(''),
	facilitatorName: z.string().trim().max(120, 'too_long').optional(),
	category: z.string().trim().max(60, 'too_long').optional(),
	/** Limits the workshop to these age groups; empty or absent means everyone. */
	ageGroupIds: z.array(z.string()).max(20).optional(),
	/** Organizers may pick another marker from the fixed set, never a free-form colour. */
	markerColor: z.enum(schema.markerColors).optional(),
	markerShape: z.enum(schema.markerShapes).optional(),
})
export type WorkshopInput = z.input<typeof workshopInput>
export type Workshop = typeof schema.workshop.$inferSelect

/**
 * Workshop n gets colour n mod 8 and shape (n + floor(n / 8)) mod 8, so 64
 * workshops get distinct pairs before any repeat (design-system.md).
 */
export function markerFor(n: number) {
	return {
		markerColor: schema.markerColors[n % 8] as (typeof schema.markerColors)[number],
		markerShape: schema.markerShapes[
			(n + Math.floor(n / 8)) % 8
		] as (typeof schema.markerShapes)[number],
	}
}

export async function createWorkshop(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
	input: WorkshopInput,
): Promise<Workshop> {
	requirePermission(ctx, { event: ['update'] })
	const { ageGroupIds, ...values } = parse(workshopInput, input)
	await getEvent(db, ctx, eventId)
	if (ageGroupIds) await assertAgeGroups(db, ctx, eventId, ageGroupIds)

	const [existing] = await db
		.select({ n: count() })
		.from(schema.workshop)
		.where(eq(schema.workshop.eventId, eventId))
	const n = existing?.n ?? 0

	const [created] = await db
		.insert(schema.workshop)
		.values({
			...values,
			markerColor: values.markerColor ?? markerFor(n).markerColor,
			markerShape: values.markerShape ?? markerFor(n).markerShape,
			sortOrder: n,
			eventId,
			organizationId: ctx.organizationId,
		})
		.returning()
	if (!created) throw new Error('Workshop insert returned nothing')
	if (ageGroupIds) await setWorkshopAgeGroups(db, created, ageGroupIds)
	await auditStatement(db, ctx, {
		action: 'workshop.create',
		subjectType: 'workshop',
		subjectId: created.id,
		eventId,
	})
	return created
}

export async function listWorkshops(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
): Promise<Workshop[]> {
	return db
		.select()
		.from(schema.workshop)
		.where(
			and(
				eq(schema.workshop.eventId, eventId),
				eq(schema.workshop.organizationId, ctx.organizationId),
			),
		)
		.orderBy(asc(schema.workshop.sortOrder))
}

export async function updateWorkshop(
	db: Db,
	ctx: OrganizerContext,
	workshopId: string,
	input: Partial<WorkshopInput>,
): Promise<Workshop> {
	requirePermission(ctx, { event: ['update'] })
	const { ageGroupIds, ...values } = parse(workshopInput.partial(), input)
	if (ageGroupIds) {
		const [current] = await db
			.select({ eventId: schema.workshop.eventId })
			.from(schema.workshop)
			.where(
				and(
					eq(schema.workshop.id, workshopId),
					eq(schema.workshop.organizationId, ctx.organizationId),
				),
			)
			.limit(1)
		if (!current) throw notFound('Workshop')
		await assertAgeGroups(db, ctx, current.eventId, ageGroupIds)
	}
	const [updated] = await db
		.update(schema.workshop)
		.set(values)
		.where(
			and(
				eq(schema.workshop.id, workshopId),
				eq(schema.workshop.organizationId, ctx.organizationId),
			),
		)
		.returning()
	if (!updated) throw notFound('Workshop')
	if (ageGroupIds) await setWorkshopAgeGroups(db, updated, ageGroupIds)
	await auditStatement(db, ctx, {
		action: 'workshop.update',
		subjectType: 'workshop',
		subjectId: workshopId,
		eventId: updated.eventId,
		data: { fields: Object.keys(values) },
	})
	return updated
}

export async function deleteWorkshop(
	db: Db,
	ctx: OrganizerContext,
	workshopId: string,
): Promise<void> {
	requirePermission(ctx, { event: ['update'] })
	const [deleted] = await db
		.delete(schema.workshop)
		.where(
			and(
				eq(schema.workshop.id, workshopId),
				eq(schema.workshop.organizationId, ctx.organizationId),
			),
		)
		.returning({ id: schema.workshop.id, eventId: schema.workshop.eventId })
	if (!deleted) throw notFound('Workshop')
	await auditStatement(db, ctx, {
		action: 'workshop.delete',
		subjectType: 'workshop',
		subjectId: workshopId,
		eventId: deleted.eventId,
	})
}
