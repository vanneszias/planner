import { type Db, schema } from '@app/db'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { auditStatement } from './audit.ts'
import { type OrganizerContext, requirePermission } from './context.ts'
import { invalid, notFound } from './errors.ts'
import { slugify, uniqueSlug } from './slug.ts'
import { isValidTimeZone, zonedToUtc } from './time.ts'
import { parse } from './validation.ts'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date')
const zonedMoment = z.object({
	date,
	time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time'),
})

const eventFields = {
	name: z.string().trim().min(1, 'required').max(120, 'too_long'),
	description: z.string().trim().max(4000, 'too_long'),
	startsOn: date,
	endsOn: date,
	timezone: z.string().refine(isValidTimeZone, 'timezone'),
	mode: z.enum(schema.eventModes),
	defaultLocale: z.enum(['en', 'nl']),
	sessionsPerParticipant: z.number().int('number').min(1, 'too_small').max(20, 'too_large'),
}

const datesInOrder = (value: { startsOn?: string; endsOn?: string }) =>
	!value.startsOn || !value.endsOn || value.endsOn >= value.startsOn

/** Guided creation (journeys.md, O1): everything else gets a default. */
export const createEventInput = z
	.object({ ...eventFields, description: eventFields.description.optional() })
	.refine(datesInOrder, { path: ['endsOn'], message: 'date_order' })
export type CreateEventInput = z.input<typeof createEventInput>

export const updateEventInput = z
	.object({
		...eventFields,
		rankLimit: z.number().int().min(1).max(20),
		rankMinimum: z.number().int().min(1).max(20).nullable(),
		showTimesWhileRanking: z.boolean(),
		showExplanations: z.boolean(),
		fillUnassigned: z.enum(schema.fillUnassignedOptions),
		allocationStrategy: z.enum(schema.allocationStrategies),
		changeCutoff: z.enum(schema.changeCutoffs),
		/** Booking or ranking window, as wall-clock times in the event's timezone. */
		opens: zonedMoment.nullable(),
		closes: zonedMoment.nullable(),
	})
	.partial()
	.refine(datesInOrder, { path: ['endsOn'], message: 'date_order' })
export type UpdateEventInput = z.input<typeof updateEventInput>

export type Event = typeof schema.event.$inferSelect

export async function createEvent(
	db: Db,
	ctx: OrganizerContext,
	input: CreateEventInput,
): Promise<Event> {
	requirePermission(ctx, { event: ['create'] })
	const values = parse(createEventInput, input)
	const slug = await uniqueSlug(slugify(values.name), async (candidate) => {
		const [row] = await db
			.select({ id: schema.event.id })
			.from(schema.event)
			.where(
				and(eq(schema.event.organizationId, ctx.organizationId), eq(schema.event.slug, candidate)),
			)
			.limit(1)
		return Boolean(row)
	})

	const [created] = await db
		.insert(schema.event)
		.values({ ...values, slug, organizationId: ctx.organizationId })
		.returning()
	if (!created) throw new Error('Event insert returned nothing')
	await auditStatement(db, ctx, {
		action: 'event.create',
		subjectType: 'event',
		subjectId: created.id,
		eventId: created.id,
	})
	return created
}

export async function listEvents(db: Db, ctx: OrganizerContext): Promise<Event[]> {
	return db
		.select()
		.from(schema.event)
		.where(eq(schema.event.organizationId, ctx.organizationId))
		.orderBy(desc(schema.event.startsOn))
}

/** Throws not_found for events in other organizations: never reveal they exist. */
export async function getEvent(db: Db, ctx: OrganizerContext, eventId: string): Promise<Event> {
	const [found] = await db
		.select()
		.from(schema.event)
		.where(and(eq(schema.event.id, eventId), eq(schema.event.organizationId, ctx.organizationId)))
		.limit(1)
	if (!found) throw notFound('Event')
	return found
}

export async function updateEvent(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
	input: UpdateEventInput,
): Promise<Event> {
	requirePermission(ctx, { event: ['update'] })
	const values = parse(updateEventInput, input)
	const current = await getEvent(db, ctx, eventId)
	const startsOn = values.startsOn ?? current.startsOn
	const endsOn = values.endsOn ?? current.endsOn
	if (!datesInOrder({ startsOn, endsOn })) throw invalid({ endsOn: 'date_order' })

	const { opens, closes, ...fields } = values
	const timezone = values.timezone ?? current.timezone
	const toInstant = (moment: { date: string; time: string } | null) =>
		moment ? zonedToUtc(moment.date, moment.time, timezone) : null
	const window: Partial<Pick<Event, 'opensAt' | 'closesAt'>> = {}
	if (opens !== undefined) window.opensAt = toInstant(opens)
	if (closes !== undefined) window.closesAt = toInstant(closes)
	const opensAt = window.opensAt !== undefined ? window.opensAt : current.opensAt
	const closesAt = window.closesAt !== undefined ? window.closesAt : current.closesAt
	if (opensAt && closesAt && closesAt <= opensAt) throw invalid({ closes: 'time_order' })

	const rankLimit = fields.rankLimit ?? current.rankLimit
	const rankMinimum = fields.rankMinimum !== undefined ? fields.rankMinimum : current.rankMinimum
	if (rankMinimum !== null && rankMinimum > rankLimit) throw invalid({ rankMinimum: 'too_large' })

	const [updated] = await db
		.update(schema.event)
		.set({ ...fields, ...window })
		.where(and(eq(schema.event.id, eventId), eq(schema.event.organizationId, ctx.organizationId)))
		.returning()
	if (!updated) throw notFound('Event')
	await auditStatement(db, ctx, {
		action: 'event.update',
		subjectType: 'event',
		subjectId: eventId,
		eventId,
		data: { fields: Object.keys(values) },
	})
	return updated
}

export async function setEventStatus(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
	status: Event['status'],
): Promise<Event> {
	requirePermission(ctx, { event: ['publish'] })
	const [updated] = await db
		.update(schema.event)
		.set({ status })
		.where(and(eq(schema.event.id, eventId), eq(schema.event.organizationId, ctx.organizationId)))
		.returning()
	if (!updated) throw notFound('Event')
	await auditStatement(db, ctx, {
		action: `event.status.${status}`,
		subjectType: 'event',
		subjectId: eventId,
		eventId,
	})
	return updated
}

export async function deleteEvent(db: Db, ctx: OrganizerContext, eventId: string): Promise<void> {
	requirePermission(ctx, { event: ['delete'] })
	const deleted = await db
		.delete(schema.event)
		.where(and(eq(schema.event.id, eventId), eq(schema.event.organizationId, ctx.organizationId)))
		.returning({ id: schema.event.id })
	if (deleted.length === 0) throw notFound('Event')
	await auditStatement(db, ctx, {
		action: 'event.delete',
		subjectType: 'event',
		subjectId: eventId,
	})
}
