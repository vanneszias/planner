import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { uuidv7 } from '../id.ts'
import { organization, user } from './auth.ts'
import { ageGroup, event, eventSession } from './events.ts'

/*
 * Participants, their places and their waitlists (docs/domain-model.md).
 * A registration is a person's enrolment in one event; minors have no user.
 */

const id = () => text('id').primaryKey().$defaultFn(uuidv7)
const createdAt = () =>
	integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date())
const organizationId = () =>
	text('organization_id')
		.notNull()
		.references(() => organization.id, { onDelete: 'cascade' })
const eventId = () =>
	text('event_id')
		.notNull()
		.references(() => event.id, { onDelete: 'cascade' })

export const registration = sqliteTable(
	'registration',
	{
		id: id(),
		organizationId: organizationId(),
		eventId: eventId(),
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		managedByUserId: text('managed_by_user_id').references(() => user.id, { onDelete: 'set null' }),
		registeredBy: text('registered_by', { enum: ['self', 'guardian', 'organizer'] }).notNull(),
		displayName: text('display_name').notNull(),
		email: text('email'),
		guardianEmail: text('guardian_email'),
		ageGroupId: text('age_group_id').references(() => ageGroup.id, { onDelete: 'set null' }),
		isMinor: integer('is_minor', { mode: 'boolean' }).notNull().default(false),
		/** SHA-256 of the private link token (D16). The token itself is never stored. */
		accessTokenHash: text('access_token_hash').notNull(),
		/** The link token, sealed with PARTICIPANT_TOKEN_KEY (passes, D29). Null until issued under the new key. */
		accessTokenSealed: text('access_token_sealed'),
		/** SHA-256 of event id + short code, so codes only work with their event. */
		shortCodeHash: text('short_code_hash').notNull(),
		feedTokenHash: text('feed_token_hash'),
		preferencesSubmittedAt: integer('preferences_submitted_at', { mode: 'timestamp_ms' }),
		status: text('status', { enum: ['active', 'cancelled'] })
			.notNull()
			.default('active'),
		/** Event-wide check-in (O8); per-session check-in lives on the assignment. */
		checkedInAt: integer('checked_in_at', { mode: 'timestamp_ms' }),
		checkedInBy: text('checked_in_by'),
		createdAt: createdAt(),
		anonymisedAt: integer('anonymised_at', { mode: 'timestamp_ms' }),
	},
	(table) => [
		uniqueIndex('registration_access_token_idx').on(table.accessTokenHash),
		uniqueIndex('registration_short_code_idx').on(table.eventId, table.shortCodeHash),
		uniqueIndex('registration_feed_token_idx').on(table.feedTokenHash),
		index('registration_event_status_idx').on(table.eventId, table.status),
		index('registration_user_idx').on(table.userId),
		index('registration_managed_by_idx').on(table.managedByUserId),
		// One self-registration per email per event (security-privacy.md).
		uniqueIndex('registration_event_email_idx').on(table.eventId, table.email),
	],
)

/** A place in a session, however it was given. The single source of itineraries. */
export const assignment = sqliteTable(
	'assignment',
	{
		id: id(),
		organizationId: organizationId(),
		eventId: eventId(),
		registrationId: text('registration_id')
			.notNull()
			.references(() => registration.id, { onDelete: 'cascade' }),
		sessionId: text('session_id')
			.notNull()
			.references(() => eventSession.id, { onDelete: 'cascade' }),
		source: text('source', { enum: ['booking', 'allocation', 'manual'] }).notNull(),
		runId: text('run_id'),
		locked: integer('locked', { mode: 'boolean' }).notNull().default(false),
		checkedInAt: integer('checked_in_at', { mode: 'timestamp_ms' }),
		checkedInBy: text('checked_in_by'),
		createdAt: createdAt(),
	},
	(table) => [
		uniqueIndex('assignment_registration_session_idx').on(table.registrationId, table.sessionId),
		index('assignment_session_idx').on(table.sessionId),
		index('assignment_event_idx').on(table.eventId),
	],
)

export const waitlistEntry = sqliteTable(
	'waitlist_entry',
	{
		id: id(),
		organizationId: organizationId(),
		eventId: eventId(),
		sessionId: text('session_id')
			.notNull()
			.references(() => eventSession.id, { onDelete: 'cascade' }),
		registrationId: text('registration_id')
			.notNull()
			.references(() => registration.id, { onDelete: 'cascade' }),
		createdAt: createdAt(),
	},
	(table) => [
		uniqueIndex('waitlist_session_registration_idx').on(table.sessionId, table.registrationId),
		index('waitlist_session_created_idx').on(table.sessionId, table.createdAt),
	],
)

/**
 * One row per email we intend to send, keyed so a redelivered queue message
 * never sends twice. Recipient addresses are not copied here.
 */
export const emailDelivery = sqliteTable('email_delivery', {
	id: id(),
	organizationId: organizationId(),
	eventId: text('event_id').references(() => event.id, { onDelete: 'cascade' }),
	idempotencyKey: text('idempotency_key').notNull().unique(),
	kind: text('kind').notNull(),
	registrationId: text('registration_id').references(() => registration.id, {
		onDelete: 'cascade',
	}),
	status: text('status', { enum: ['pending', 'sent', 'failed'] })
		.notNull()
		.default('pending'),
	providerMessageId: text('provider_message_id'),
	attempts: integer('attempts').notNull().default(0),
	createdAt: createdAt(),
	sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
})

export const exportKinds = ['participants', 'programmes', 'attendance'] as const

/**
 * A CSV the jobs Worker builds into R2 (journeys.md, O9). The file holds
 * personal data, so it expires: the daily cron deletes it after `expires_at`.
 */
export const exportJob = sqliteTable(
	'export_job',
	{
		id: id(),
		organizationId: organizationId(),
		eventId: eventId(),
		kind: text('kind', { enum: exportKinds }).notNull(),
		status: text('status', { enum: ['pending', 'ready', 'failed', 'expired'] })
			.notNull()
			.default('pending'),
		r2Key: text('r2_key'),
		rows: integer('rows'),
		requestedBy: text('requested_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	},
	(table) => [
		index('export_job_event_idx').on(table.eventId, table.createdAt),
		index('export_job_expires_idx').on(table.status, table.expiresAt),
	],
)
