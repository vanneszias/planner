import { type Db, schema } from '@app/db'
import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { auditStatement } from './audit.ts'
import { type OrganizerContext, requirePermission } from './context.ts'
import { invalid, notFound } from './errors.ts'
import { type Event, getEvent } from './events.ts'
import { utcToZoned, zonedToUtc } from './time.ts'
import { parse } from './validation.ts'

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time')

const slotInput = z
	.object({
		date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date'),
		start: time,
		end: time,
	})
	.refine((slot) => slot.end > slot.start, { path: ['end'], message: 'time_order' })

/** "Repeat this workshop at these times" (journeys.md, O2): one or more slots at once. */
export const createSessionsInput = z.object({
	workshopId: z.string().min(1, 'required'),
	room: z.string().trim().max(80, 'too_long').optional(),
	capacity: z.number().int('number').min(0, 'too_small').max(10_000, 'too_large'),
	slots: z.array(slotInput).min(1, 'required').max(50, 'too_many'),
})
export type CreateSessionsInput = z.input<typeof createSessionsInput>

export const updateSessionInput = z.object({
	room: z.string().trim().max(80, 'too_long').optional(),
	capacity: z.number().int('number').min(0, 'too_small').max(10_000, 'too_large').optional(),
	slot: slotInput.optional(),
})
export type UpdateSessionInput = z.input<typeof updateSessionInput>

export type SessionRow = {
	id: string
	workshopId: string
	workshopTitle: string
	markerColor: (typeof schema.markerColors)[number]
	markerShape: (typeof schema.markerShapes)[number]
	locationId: string | null
	room: string | null
	startsAt: Date
	endsAt: Date
	capacity: number
	status: 'scheduled' | 'cancelled'
}

function toInstants(event: Event, slot: z.output<typeof slotInput>, index: number) {
	if (slot.date < event.startsOn || slot.date > event.endsOn) {
		throw invalid({ [`slots.${index}.date`]: 'outside_event' })
	}
	return {
		startsAt: zonedToUtc(slot.date, slot.start, event.timezone),
		endsAt: zonedToUtc(slot.date, slot.end, event.timezone),
	}
}

/** Rooms are typed, not picked: reuse a location with the same name (case-insensitive). */
async function resolveLocation(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
	room: string | undefined,
): Promise<string | null> {
	if (!room) return null
	const [existing] = await db
		.select({ id: schema.location.id })
		.from(schema.location)
		.where(
			and(
				eq(schema.location.eventId, eventId),
				eq(schema.location.organizationId, ctx.organizationId),
				sql`lower(${schema.location.name}) = lower(${room})`,
			),
		)
		.limit(1)
	if (existing) return existing.id
	const [created] = await db
		.insert(schema.location)
		.values({ name: room, eventId, organizationId: ctx.organizationId })
		.returning({ id: schema.location.id })
	return created?.id ?? null
}

export async function createSessions(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
	input: CreateSessionsInput,
): Promise<string[]> {
	requirePermission(ctx, { event: ['update'] })
	const values = parse(createSessionsInput, input)
	const event = await getEvent(db, ctx, eventId)

	const [workshop] = await db
		.select({ id: schema.workshop.id })
		.from(schema.workshop)
		.where(
			and(
				eq(schema.workshop.id, values.workshopId),
				eq(schema.workshop.eventId, eventId),
				eq(schema.workshop.organizationId, ctx.organizationId),
			),
		)
		.limit(1)
	if (!workshop) throw invalid({ workshopId: 'not_found' })

	const instants = values.slots.map((slot, index) => toInstants(event, slot, index))
	const locationId = await resolveLocation(db, ctx, eventId, values.room)

	const created = await db
		.insert(schema.eventSession)
		.values(
			instants.map((instant) => ({
				...instant,
				capacity: values.capacity,
				workshopId: values.workshopId,
				locationId,
				eventId,
				organizationId: ctx.organizationId,
			})),
		)
		.returning({ id: schema.eventSession.id })
	await auditStatement(db, ctx, {
		action: 'session.create',
		subjectType: 'workshop',
		subjectId: values.workshopId,
		eventId,
		data: { sessionIds: created.map((row) => row.id) },
	})
	return created.map((row) => row.id)
}

export async function listSessions(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
): Promise<SessionRow[]> {
	return db
		.select({
			id: schema.eventSession.id,
			workshopId: schema.eventSession.workshopId,
			workshopTitle: schema.workshop.title,
			markerColor: schema.workshop.markerColor,
			markerShape: schema.workshop.markerShape,
			locationId: schema.eventSession.locationId,
			room: schema.location.name,
			startsAt: schema.eventSession.startsAt,
			endsAt: schema.eventSession.endsAt,
			capacity: schema.eventSession.capacity,
			status: schema.eventSession.status,
		})
		.from(schema.eventSession)
		.innerJoin(schema.workshop, eq(schema.workshop.id, schema.eventSession.workshopId))
		.leftJoin(schema.location, eq(schema.location.id, schema.eventSession.locationId))
		.where(
			and(
				eq(schema.eventSession.eventId, eventId),
				eq(schema.eventSession.organizationId, ctx.organizationId),
			),
		)
		.orderBy(asc(schema.eventSession.startsAt), asc(schema.workshop.sortOrder))
}

export async function updateSession(
	db: Db,
	ctx: OrganizerContext,
	sessionId: string,
	input: UpdateSessionInput,
): Promise<void> {
	requirePermission(ctx, { event: ['update'] })
	const values = parse(updateSessionInput, input)
	const [current] = await db
		.select({ eventId: schema.eventSession.eventId })
		.from(schema.eventSession)
		.where(
			and(
				eq(schema.eventSession.id, sessionId),
				eq(schema.eventSession.organizationId, ctx.organizationId),
			),
		)
		.limit(1)
	if (!current) throw notFound('Session')
	const event = await getEvent(db, ctx, current.eventId)

	const changes: Partial<typeof schema.eventSession.$inferInsert> = {}
	if (values.capacity !== undefined) changes.capacity = values.capacity
	if (values.slot) Object.assign(changes, toInstants(event, values.slot, 0))
	if (values.room !== undefined) {
		changes.locationId = await resolveLocation(db, ctx, event.id, values.room || undefined)
	}

	await db
		.update(schema.eventSession)
		.set(changes)
		.where(
			and(
				eq(schema.eventSession.id, sessionId),
				eq(schema.eventSession.organizationId, ctx.organizationId),
			),
		)
	await auditStatement(db, ctx, {
		action: 'session.update',
		subjectType: 'session',
		subjectId: sessionId,
		eventId: event.id,
		data: { fields: Object.keys(changes) },
	})
}

export async function deleteSession(
	db: Db,
	ctx: OrganizerContext,
	sessionId: string,
): Promise<void> {
	requirePermission(ctx, { event: ['update'] })
	const [deleted] = await db
		.delete(schema.eventSession)
		.where(
			and(
				eq(schema.eventSession.id, sessionId),
				eq(schema.eventSession.organizationId, ctx.organizationId),
			),
		)
		.returning({ eventId: schema.eventSession.eventId })
	if (!deleted) throw notFound('Session')
	await auditStatement(db, ctx, {
		action: 'session.delete',
		subjectType: 'session',
		subjectId: sessionId,
		eventId: deleted.eventId,
	})
}

/** Pairs of sessions that use the same room at overlapping times. Shown inline in the editor. */
export function roomConflicts(sessions: SessionRow[]): [string, string][] {
	const conflicts: [string, string][] = []
	const active = sessions.filter((s) => s.locationId && s.status === 'scheduled')
	for (let i = 0; i < active.length; i++) {
		for (let j = i + 1; j < active.length; j++) {
			const a = active[i] as SessionRow
			const b = active[j] as SessionRow
			if (a.locationId === b.locationId && a.startsAt < b.endsAt && b.startsAt < a.endsAt) {
				conflicts.push([a.id, b.id])
			}
		}
	}
	return conflicts
}

/** Session times as the organizer entered them, for editing. */
export function sessionSlot(session: Pick<SessionRow, 'startsAt' | 'endsAt'>, timeZone: string) {
	const start = utcToZoned(session.startsAt, timeZone)
	return { date: start.date, start: start.time, end: utcToZoned(session.endsAt, timeZone).time }
}
