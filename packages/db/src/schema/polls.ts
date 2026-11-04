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
 * Availability polls ("find an evening"): an organizer sends a link, everyone
 * paints when they're free on a 30-minute grid, and a time is confirmed by the
 * organizer or automatically at a deadline (docs/availability-polls.md).
 * Separate from events: a poll has no workshops, sessions or registrations.
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

export const pollStatuses = ['open', 'needs_decision', 'confirmed', 'cancelled'] as const
export const pollDecisionModes = ['manual', 'auto'] as const

/** A saved set of organization members, to start the next poll from in one go. */
export const pollGroup = sqliteTable(
	'poll_group',
	{
		id: id(),
		organizationId: organizationId(),
		name: text('name').notNull(),
		createdAt: createdAt(),
	},
	(table) => [index('poll_group_organization_idx').on(table.organizationId)],
)

export const pollGroupMember = sqliteTable(
	'poll_group_member',
	{
		groupId: text('group_id')
			.notNull()
			.references(() => pollGroup.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
	},
	(table) => [primaryKey({ columns: [table.groupId, table.userId] })],
)

export const poll = sqliteTable(
	'poll',
	{
		id: id(),
		organizationId: organizationId(),
		createdByUserId: text('created_by_user_id').references(() => user.id, {
			onDelete: 'set null',
		}),
		groupId: text('group_id').references(() => pollGroup.id, { onDelete: 'set null' }),
		/**
		 * What the shared link carries. Not a personal credential (it's meant
		 * for a group chat), so it's stored as is and shown to organizers.
		 */
		shareCode: text('share_code').notNull(),
		title: text('title').notNull(),
		description: text('description').notNull().default(''),
		location: text('location').notNull().default(''),
		timezone: text('timezone').notNull(),
		locale: text('locale', { enum: ['en', 'nl'] })
			.notNull()
			.default('en'),
		startsOn: text('starts_on').notNull(), // YYYY-MM-DD, first day of the grid
		endsOn: text('ends_on').notNull(), // last day of the grid
		/** Daily grid, as minutes after local midnight: 1140 is 19:00, 1440 is midnight. */
		dayStartMinutes: integer('day_start_minutes').notNull(),
		dayEndMinutes: integer('day_end_minutes').notNull(),
		durationMinutes: integer('duration_minutes').notNull(),
		decisionMode: text('decision_mode', { enum: pollDecisionModes }).notNull().default('manual'),
		deadlineAt: integer('deadline_at', { mode: 'timestamp_ms' }),
		/** Auto mode: the fewest people (free or "if needed") a time needs to be confirmed. */
		minAttendees: integer('min_attendees'),
		/** Whether respondents see each other's names, or counts only. Organizers always see names. */
		showNames: integer('show_names', { mode: 'boolean' }).notNull().default(true),
		status: text('status', { enum: pollStatuses }).notNull().default('open'),
		confirmedStartsAt: integer('confirmed_starts_at', { mode: 'timestamp_ms' }),
		confirmedEndsAt: integer('confirmed_ends_at', { mode: 'timestamp_ms' }),
		confirmedAt: integer('confirmed_at', { mode: 'timestamp_ms' }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		uniqueIndex('poll_share_code_idx').on(table.shareCode),
		index('poll_organization_idx').on(table.organizationId, table.createdAt),
		index('poll_due_idx').on(table.status, table.decisionMode, table.deadlineAt),
		check('poll_dates_check', sql`${table.endsOn} >= ${table.startsOn}`),
		check(
			'poll_hours_check',
			sql`${table.dayStartMinutes} >= 0 and ${table.dayEndMinutes} <= 1440 and ${table.dayEndMinutes} > ${table.dayStartMinutes}`,
		),
		check('poll_duration_check', sql`${table.durationMinutes} >= 30`),
	],
)

/** Cell start instants (UTC milliseconds) a respondent marked. */
export type PollAvailability = { free: number[]; ifNeeded: number[] }

export const pollRespondent = sqliteTable(
	'poll_respondent',
	{
		id: id(),
		organizationId: organizationId(),
		pollId: text('poll_id')
			.notNull()
			.references(() => poll.id, { onDelete: 'cascade' }),
		/** Set when the respondent was signed in; guests have a private edit link instead. */
		userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
		displayName: text('display_name').notNull(),
		/** Optional for guests, to hear when the time is confirmed. Signed-in users use their account email. */
		email: text('email'),
		/** SHA-256 of the guest's edit token. The token itself is never stored. */
		editTokenHash: text('edit_token_hash'),
		availability: text('availability', { mode: 'json' })
			.$type<PollAvailability>()
			.notNull()
			.default({ free: [], ifNeeded: [] }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [
		index('poll_respondent_poll_idx').on(table.pollId, table.createdAt),
		uniqueIndex('poll_respondent_user_idx').on(table.pollId, table.userId),
		uniqueIndex('poll_respondent_token_idx').on(table.editTokenHash),
	],
)
