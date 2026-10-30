import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { uuidv7 } from '../id.ts'
import { organization, user } from './auth.ts'
import { event, eventSession, workshop } from './events.ts'
import { registration } from './participants.ts'

/*
 * Rankings and allocation runs (docs/allocation-mvp.md, "Lifecycle").
 * Run inputs and results are large and contain names, so they live in R2;
 * D1 keeps the run's metadata and summary numbers.
 */

const organizationId = () =>
	text('organization_id')
		.notNull()
		.references(() => organization.id, { onDelete: 'cascade' })
const eventId = () =>
	text('event_id')
		.notNull()
		.references(() => event.id, { onDelete: 'cascade' })

export const preference = sqliteTable(
	'preference',
	{
		registrationId: text('registration_id')
			.notNull()
			.references(() => registration.id, { onDelete: 'cascade' }),
		workshopId: text('workshop_id')
			.notNull()
			.references(() => workshop.id, { onDelete: 'cascade' }),
		organizationId: organizationId(),
		eventId: eventId(),
		rank: integer('rank').notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.registrationId, table.workshopId] }),
		uniqueIndex('preference_registration_rank_idx').on(table.registrationId, table.rank),
		index('preference_event_idx').on(table.eventId),
	],
)

export const runStatuses = ['draft', 'published', 'superseded'] as const

export const allocationRun = sqliteTable(
	'allocation_run',
	{
		id: text('id').primaryKey().$defaultFn(uuidv7),
		organizationId: organizationId(),
		eventId: eventId(),
		status: text('status', { enum: runStatuses }).notNull().default('draft'),
		strategy: text('strategy', { enum: ['take-turns', 'early-birds'] }).notNull(),
		fillUnassigned: text('fill_unassigned', { enum: ['none', 'any-open'] }).notNull(),
		seed: text('seed').notNull(),
		engineVersion: text('engine_version').notNull(),
		inputHash: text('input_hash').notNull(),
		/** R2 keys: the snapshot that went in and the full result with traces. */
		inputKey: text('input_key').notNull(),
		resultKey: text('result_key').notNull(),
		metrics: text('metrics', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
		/** The run this one was derived from, e.g. "Fill all empty places" (D27). */
		parentRunId: text('parent_run_id'),
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date()),
		publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
	},
	(table) => [
		index('allocation_run_event_idx').on(table.eventId, table.createdAt),
		// At most one published run per event.
		uniqueIndex('allocation_run_published_idx').on(table.eventId).where(sql`status = 'published'`),
	],
)

/** An organizer's manual change to a draft: move, remove (no target) or place (no source). */
export const allocationOverride = sqliteTable(
	'allocation_override',
	{
		id: text('id').primaryKey().$defaultFn(uuidv7),
		organizationId: organizationId(),
		runId: text('run_id')
			.notNull()
			.references(() => allocationRun.id, { onDelete: 'cascade' }),
		registrationId: text('registration_id')
			.notNull()
			.references(() => registration.id, { onDelete: 'cascade' }),
		fromSessionId: text('from_session_id').references(() => eventSession.id, {
			onDelete: 'cascade',
		}),
		toSessionId: text('to_session_id').references(() => eventSession.id, { onDelete: 'cascade' }),
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => [index('allocation_override_run_idx').on(table.runId, table.createdAt)],
)
