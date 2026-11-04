import { type Db, schema } from '@app/db'
import { and, desc, eq, like, lt } from 'drizzle-orm'
import { type OrganizerContext, requirePermission } from './context.ts'

/** Records an organizer action. `data` holds IDs and field names only, never personal data. */
export function auditStatement(
	db: Db,
	ctx: OrganizerContext,
	entry: {
		action: string
		subjectType: string
		subjectId: string
		eventId?: string
		data?: Record<string, unknown>
	},
) {
	return db.insert(schema.auditLog).values({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		actorKind: 'user',
		...entry,
	})
}

/** Kinds of action the audit screen filters by: the part of `action` before the first dot. */
export const auditCategories = [
	'event',
	'workshop',
	'session',
	'age_groups',
	'participants',
	'preferences',
	'allocation',
	'checkin',
	'export',
	'retention',
	'organization',
	'poll',
] as const
export type AuditCategory = (typeof auditCategories)[number]

export type AuditFilters = {
	eventId?: string
	category?: AuditCategory
	actorUserId?: string
	/** Entry id to continue after (ids are UUIDv7, so they sort by time). */
	before?: string
}

export type AuditEntry = {
	id: string
	createdAt: number
	action: string
	actorKind: 'user' | 'participant' | 'system'
	actorName: string | null
	eventId: string | null
	eventName: string | null
	subjectType: string
	subjectId: string
	data: AuditData | null
}

/** What audit entries hold: IDs, counts, kinds and field names (plain JSON values). */
export type AuditData = Record<string, string | number | boolean | null | string[]>

const pageSize = 50

/** The organization's audit log, newest first, 50 per page. Owners only. */
export async function listAuditLog(
	db: Db,
	ctx: OrganizerContext,
	filters: AuditFilters = {},
): Promise<{ entries: AuditEntry[]; next: string | null }> {
	requirePermission(ctx, { audit: ['read'] })
	const category =
		filters.category && auditCategories.includes(filters.category) ? filters.category : undefined
	const rows = await db
		.select({
			id: schema.auditLog.id,
			createdAt: schema.auditLog.createdAt,
			action: schema.auditLog.action,
			actorKind: schema.auditLog.actorKind,
			actorName: schema.user.name,
			eventId: schema.auditLog.eventId,
			eventName: schema.event.name,
			subjectType: schema.auditLog.subjectType,
			subjectId: schema.auditLog.subjectId,
			data: schema.auditLog.data,
		})
		.from(schema.auditLog)
		.leftJoin(schema.user, eq(schema.user.id, schema.auditLog.actorUserId))
		.leftJoin(schema.event, eq(schema.event.id, schema.auditLog.eventId))
		.where(
			and(
				eq(schema.auditLog.organizationId, ctx.organizationId),
				filters.eventId ? eq(schema.auditLog.eventId, filters.eventId) : undefined,
				filters.actorUserId ? eq(schema.auditLog.actorUserId, filters.actorUserId) : undefined,
				category ? like(schema.auditLog.action, `${category}.%`) : undefined,
				filters.before ? lt(schema.auditLog.id, filters.before) : undefined,
			),
		)
		.orderBy(desc(schema.auditLog.id))
		.limit(pageSize + 1)
	const entries = rows.slice(0, pageSize).map((r) => ({
		...r,
		createdAt: r.createdAt.getTime(),
		data: (r.data as AuditData | null) ?? null,
	}))
	return { entries, next: rows.length > pageSize ? (entries.at(-1)?.id ?? null) : null }
}
