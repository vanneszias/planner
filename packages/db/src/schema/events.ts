import { sql } from 'drizzle-orm'
import {
	check,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { uuidv7 } from '../id.ts'
import { organization, user } from './auth.ts'

/*
 * Events, workshops and sessions (docs/domain-model.md). Every tenant-owned
 * table carries organization_id, even where a join could supply it, so scoping
 * and deletion never depend on a join.
 */

const id = () => text('id').primaryKey().$defaultFn(uuidv7)
const createdAt = () =>
	integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date())
const updatedAt = () =>
	integer('updated_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date())
		.$onUpdateFn(() => new Date())
const organizationId = () =>
	text('organization_id')
		.notNull()
		.references(() => organization.id, { onDelete: 'cascade' })

export const eventStatuses = ['draft', 'published', 'closed', 'archived'] as const
export const eventModes = ['booking', 'ranking'] as const
export const fillUnassignedOptions = ['none', 'any-open'] as const
export const allocationStrategies = ['take-turns', 'early-birds'] as const
export const changeCutoffs = ['booking-closes', 'session-start'] as const

export const event = sqliteTable(
	'event',
	{
		id: id(),
		organizationId: organizationId(),
		slug: text('slug').notNull(),
		name: text('name').notNull(),
		description: text('description').notNull().default(''),
		timezone: text('timezone').notNull(),
		startsOn: text('starts_on').notNull(), // YYYY-MM-DD
		endsOn: text('ends_on').notNull(),
		status: text('status', { enum: eventStatuses }).notNull().default('draft'),
		mode: text('mode', { enum: eventModes }).notNull().default('booking'),
		defaultLocale: text('default_locale', { enum: ['en', 'nl'] })
			.notNull()
			.default('en'),
		sessionsPerParticipant: integer('sessions_per_participant').notNull().default(3),
		rankLimit: integer('rank_limit').notNull().default(5),
		rankMinimum: integer('rank_minimum'), // null: sessions_per_participant + 1 (D26)
		showTimesWhileRanking: integer('show_times_while_ranking', { mode: 'boolean' })
			.notNull()
			.default(true),
		showExplanations: integer('show_explanations', { mode: 'boolean' }).notNull().default(false),
		fillUnassigned: text('fill_unassigned', { enum: fillUnassignedOptions })
			.notNull()
			.default('none'),
		allocationStrategy: text('allocation_strategy', { enum: allocationStrategies })
			.notNull()
			.default('take-turns'),
		changeCutoff: text('change_cutoff', { enum: changeCutoffs })
			.notNull()
			.default('booking-closes'),
		opensAt: integer('opens_at', { mode: 'timestamp_ms' }),
		closesAt: integer('closes_at', { mode: 'timestamp_ms' }),
		retentionDays: integer('retention_days').notNull().default(90),
		dataDeletedAt: integer('data_deleted_at', { mode: 'timestamp_ms' }),
		logoKey: text('logo_key'),
		accentColor: text('accent_color'),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		uniqueIndex('event_organization_slug_idx').on(table.organizationId, table.slug),
		index('event_organization_starts_idx').on(table.organizationId, table.startsOn),
		check('event_dates_check', sql`${table.endsOn} >= ${table.startsOn}`),
		check('event_sessions_check', sql`${table.sessionsPerParticipant} between 1 and 20`),
		check('event_rank_limit_check', sql`${table.rankLimit} between 1 and 20`),
	],
)

export const ageGroup = sqliteTable(
	'age_group',
	{
		id: id(),
		organizationId: organizationId(),
		eventId: text('event_id')
			.notNull()
			.references(() => event.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		sortOrder: integer('sort_order').notNull().default(0),
	},
	(table) => [index('age_group_event_idx').on(table.eventId, table.sortOrder)],
)

export const location = sqliteTable(
	'location',
	{
		id: id(),
		organizationId: organizationId(),
		eventId: text('event_id')
			.notNull()
			.references(() => event.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		notes: text('notes'),
	},
	(table) => [index('location_event_idx').on(table.eventId)],
)

export const markerColors = [
	'tomato',
	'sun',
	'grass',
	'sea',
	'grape',
	'bubblegum',
	'sky',
	'moss',
] as const
export const markerShapes = [
	'circle',
	'triangle',
	'square',
	'diamond',
	'star',
	'hexagon',
	'plus',
	'moon',
] as const

export const workshop = sqliteTable(
	'workshop',
	{
		id: id(),
		organizationId: organizationId(),
		eventId: text('event_id')
			.notNull()
			.references(() => event.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		description: text('description').notNull().default(''),
		imageKey: text('image_key'),
		facilitatorName: text('facilitator_name'),
		category: text('category'),
		markerColor: text('marker_color', { enum: markerColors }).notNull(),
		markerShape: text('marker_shape', { enum: markerShapes }).notNull(),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [index('workshop_event_idx').on(table.eventId, table.sortOrder)],
)

/** No rows for a workshop means it's open to every age group. */
export const workshopAgeGroup = sqliteTable(
	'workshop_age_group',
	{
		workshopId: text('workshop_id')
			.notNull()
			.references(() => workshop.id, { onDelete: 'cascade' }),
		ageGroupId: text('age_group_id')
			.notNull()
			.references(() => ageGroup.id, { onDelete: 'cascade' }),
	},
	(table) => [primaryKey({ columns: [table.workshopId, table.ageGroupId] })],
)

// Named event_session: Better Auth already owns the `session` table (sign-in sessions).
export const eventSession = sqliteTable(
	'event_session',
	{
		id: id(),
		organizationId: organizationId(),
		eventId: text('event_id')
			.notNull()
			.references(() => event.id, { onDelete: 'cascade' }),
		workshopId: text('workshop_id')
			.notNull()
			.references(() => workshop.id, { onDelete: 'cascade' }),
		locationId: text('location_id').references(() => location.id, { onDelete: 'set null' }),
		startsAt: integer('starts_at', { mode: 'timestamp_ms' }).notNull(),
		endsAt: integer('ends_at', { mode: 'timestamp_ms' }).notNull(),
		capacity: integer('capacity').notNull(),
		status: text('status', { enum: ['scheduled', 'cancelled'] })
			.notNull()
			.default('scheduled'),
	},
	(table) => [
		index('event_session_event_starts_idx').on(table.eventId, table.startsAt),
		index('event_session_workshop_idx').on(table.workshopId),
		check('event_session_times_check', sql`${table.endsAt} > ${table.startsAt}`),
		check('event_session_capacity_check', sql`${table.capacity} >= 0`),
	],
)

/** Old public paths keep working after a slug rename (printed QR codes). */
export const slugRedirect = sqliteTable('slug_redirect', {
	oldPath: text('old_path').primaryKey(),
	organizationId: organizationId(),
	eventId: text('event_id').references(() => event.id, { onDelete: 'cascade' }),
	createdAt: createdAt(),
})

/** IDs and changed field names only; never names or emails (security-privacy.md). */
export const auditLog = sqliteTable(
	'audit_log',
	{
		id: id(),
		organizationId: organizationId(),
		eventId: text('event_id').references(() => event.id, { onDelete: 'cascade' }),
		actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
		actorKind: text('actor_kind', { enum: ['user', 'participant', 'system'] }).notNull(),
		action: text('action').notNull(),
		subjectType: text('subject_type').notNull(),
		subjectId: text('subject_id').notNull(),
		data: text('data', { mode: 'json' }).$type<Record<string, unknown>>(),
		createdAt: createdAt(),
	},
	(table) => [
		index('audit_log_organization_idx').on(table.organizationId, table.createdAt),
		index('audit_log_event_idx').on(table.eventId, table.createdAt),
	],
)
