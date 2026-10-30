import { type Db, schema } from '@app/db'
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm'
import { z } from 'zod'
import { auditStatement } from './audit.ts'
import { type OrganizerContext, requirePermission } from './context.ts'
import { invalid } from './errors.ts'
import { getEvent } from './events.ts'
import { parse } from './validation.ts'

/*
 * Age groups (D2) and which workshops each may join. A workshop with no
 * age groups is open to everyone.
 */

export const ageGroupsInput = z
	.array(
		z.object({
			id: z.string().optional(),
			label: z.string().trim().min(1, 'required').max(40, 'too_long'),
		}),
	)
	.max(12, 'too_many')

export type AgeGroup = { id: string; label: string }

export async function listAgeGroups(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
): Promise<AgeGroup[]> {
	return db
		.select({ id: schema.ageGroup.id, label: schema.ageGroup.label })
		.from(schema.ageGroup)
		.where(
			and(
				eq(schema.ageGroup.eventId, eventId),
				eq(schema.ageGroup.organizationId, ctx.organizationId),
			),
		)
		.orderBy(asc(schema.ageGroup.sortOrder))
}

/**
 * Replaces the event's age groups with the given list, in order. Groups left
 * out are deleted, and so are their links to workshops.
 */
export async function saveAgeGroups(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
	input: z.input<typeof ageGroupsInput>,
): Promise<AgeGroup[]> {
	requirePermission(ctx, { event: ['update'] })
	const groups = parse(ageGroupsInput, input)
	await getEvent(db, ctx, eventId)

	const labels = groups.map((group) => group.label.toLowerCase())
	const duplicate = labels.findIndex((label, index) => labels.indexOf(label) !== index)
	if (duplicate !== -1) throw invalid({ [`${duplicate}.label`]: 'duplicate' })

	const existing = await listAgeGroups(db, ctx, eventId)
	const existingIds = new Set(existing.map((group) => group.id))
	const keptIds = groups.flatMap((group) =>
		group.id && existingIds.has(group.id) ? [group.id] : [],
	)
	const scope = and(
		eq(schema.ageGroup.eventId, eventId),
		eq(schema.ageGroup.organizationId, ctx.organizationId),
	)

	await db.batch([
		db
			.delete(schema.ageGroup)
			.where(keptIds.length ? and(scope, notInArray(schema.ageGroup.id, keptIds)) : scope),
		...groups.map((group, sortOrder) =>
			group.id && existingIds.has(group.id)
				? db
						.update(schema.ageGroup)
						.set({ label: group.label, sortOrder })
						.where(and(scope, eq(schema.ageGroup.id, group.id)))
				: db.insert(schema.ageGroup).values({
						label: group.label,
						sortOrder,
						eventId,
						organizationId: ctx.organizationId,
					}),
		),
	])
	await auditStatement(db, ctx, {
		action: 'age_groups.save',
		subjectType: 'event',
		subjectId: eventId,
		eventId,
	})
	return listAgeGroups(db, ctx, eventId)
}

/** Which age groups each workshop of an event is limited to. */
export async function workshopAgeGroupIds(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
): Promise<Record<string, string[]>> {
	const rows = await db
		.select({
			workshopId: schema.workshopAgeGroup.workshopId,
			ageGroupId: schema.workshopAgeGroup.ageGroupId,
		})
		.from(schema.workshopAgeGroup)
		.innerJoin(schema.workshop, eq(schema.workshop.id, schema.workshopAgeGroup.workshopId))
		.where(
			and(
				eq(schema.workshop.eventId, eventId),
				eq(schema.workshop.organizationId, ctx.organizationId),
			),
		)
	const byWorkshop: Record<string, string[]> = {}
	for (const row of rows) {
		byWorkshop[row.workshopId] = [...(byWorkshop[row.workshopId] ?? []), row.ageGroupId]
	}
	return byWorkshop
}

/** Throws unless every ID is an age group of this event. Call before writing anything. */
export async function assertAgeGroups(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
	ageGroupIds: string[],
): Promise<void> {
	const unique = [...new Set(ageGroupIds)]
	if (unique.length > 0) {
		const valid = await db
			.select({ id: schema.ageGroup.id })
			.from(schema.ageGroup)
			.where(
				and(
					eq(schema.ageGroup.eventId, eventId),
					eq(schema.ageGroup.organizationId, ctx.organizationId),
					inArray(schema.ageGroup.id, unique),
				),
			)
		if (valid.length !== unique.length) throw invalid({ ageGroupIds: 'not_found' })
	}
}

/** Replaces a workshop's age groups. Validate with assertAgeGroups first. */
export async function setWorkshopAgeGroups(
	db: Db,
	workshop: { id: string },
	ageGroupIds: string[],
): Promise<void> {
	const unique = [...new Set(ageGroupIds)]
	await db.batch([
		db.delete(schema.workshopAgeGroup).where(eq(schema.workshopAgeGroup.workshopId, workshop.id)),
		...unique.map((ageGroupId) =>
			db.insert(schema.workshopAgeGroup).values({ workshopId: workshop.id, ageGroupId }),
		),
	])
}
