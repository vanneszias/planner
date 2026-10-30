import { type Db, schema } from '@app/db'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { auditStatement } from './audit.ts'
import { type OrganizerContext, requirePermission } from './context.ts'
import { getEvent } from './events.ts'
import type { FileStorage } from './files.ts'

/*
 * Retention (docs/domain-model.md, "Retention"; D6, D20, D21). 90 days after
 * an event ends its participant data is anonymised, not deleted: names,
 * emails, account links, credentials, rankings, waitlists and snapshots go;
 * anonymous places and check-ins stay for attendance statistics.
 *
 * Every step is idempotent and works in chunks of rows selected by a
 * subquery, so no statement binds more than a handful of values (D1 allows
 * 100) and a run cut short by a crash simply continues next time.
 */

/** Rows changed per statement. */
const rowsPerRound = 500

/** The day an event's participant data goes: `ends_on + retention_days`, as YYYY-MM-DD. */
export function anonymisationDate(event: { endsOn: string; retentionDays: number }): string {
	const [year, month, day] = event.endsOn.split('-').map(Number)
	const date = new Date(Date.UTC(year as number, (month as number) - 1, day))
	date.setUTCDate(date.getUTCDate() + event.retentionDays)
	return date.toISOString().slice(0, 10)
}

/** Events whose anonymisation date has come and that still hold participant data. */
export async function eventsDueForAnonymisation(db: Db, now = new Date()): Promise<string[]> {
	const today = now.toISOString().slice(0, 10)
	const due = await db
		.select({ id: schema.event.id })
		.from(schema.event)
		.where(
			and(
				isNull(schema.event.dataDeletedAt),
				sql`date(${schema.event.endsOn}, '+' || ${schema.event.retentionDays} || ' days') <= ${today}`,
			),
		)
		.limit(50)
	return due.map((e) => e.id)
}

/** Repeats a chunked statement until it changes nothing. */
async function untilDone(run: () => Promise<{ meta: { changes?: number } }>) {
	let total = 0
	for (;;) {
		const changes = (await run()).meta.changes ?? 0
		total += changes
		if (changes === 0) return total
	}
}

export type Anonymised = { registrations: number; files: number }

/**
 * Anonymises one event. `actor` is the organizer who pressed "Anonymise now",
 * or null for the daily cron.
 */
export async function anonymiseEvent(
	db: Db,
	files: FileStorage,
	eventId: string,
	actor: OrganizerContext | null,
	now = new Date(),
): Promise<Anonymised> {
	const [event] = await db
		.select({
			id: schema.event.id,
			organizationId: schema.event.organizationId,
			dataDeletedAt: schema.event.dataDeletedAt,
		})
		.from(schema.event)
		.where(eq(schema.event.id, eventId))
		.limit(1)
	if (!event || event.dataDeletedAt) return { registrations: 0, files: 0 }

	// Credentials become values no hash can match ("anonymised:" + id keeps them
	// unique), which revokes links, codes and participant cookies at once.
	const registrations = await untilDone(() =>
		db.run(sql`
			UPDATE registration SET
				display_name = '', email = NULL, guardian_email = NULL,
				user_id = NULL, managed_by_user_id = NULL,
				access_token_hash = 'anonymised:' || id, short_code_hash = 'anonymised:' || id,
				feed_token_hash = NULL, checked_in_by = NULL, anonymised_at = ${now.getTime()}
			WHERE id IN (
				SELECT id FROM registration
				WHERE event_id = ${eventId} AND anonymised_at IS NULL
				LIMIT ${rowsPerRound}
			)`),
	)
	for (const table of ['preference', 'waitlist_entry', 'email_delivery'] as const) {
		await untilDone(() =>
			db.run(
				sql`DELETE FROM ${sql.identifier(table)} WHERE rowid IN (
					SELECT rowid FROM ${sql.identifier(table)} WHERE event_id = ${eventId} LIMIT ${rowsPerRound}
				)`,
			),
		)
	}

	// Run snapshots and exports hold names. Assignments and run metrics stay.
	const [runs, exports] = await Promise.all([
		db
			.select({
				inputKey: schema.allocationRun.inputKey,
				resultKey: schema.allocationRun.resultKey,
			})
			.from(schema.allocationRun)
			.where(eq(schema.allocationRun.eventId, eventId)),
		db
			.select({ id: schema.exportJob.id, r2Key: schema.exportJob.r2Key })
			.from(schema.exportJob)
			.where(and(eq(schema.exportJob.eventId, eventId), ne(schema.exportJob.status, 'expired'))),
	])
	const keys = [
		...runs.flatMap((r) => [r.inputKey, r.resultKey]),
		...exports.flatMap((e) => (e.r2Key ? [e.r2Key] : [])),
	]
	await files.delete(keys)
	if (exports.length > 0) {
		await db
			.update(schema.exportJob)
			.set({ status: 'expired', r2Key: null })
			.where(and(eq(schema.exportJob.eventId, eventId), ne(schema.exportJob.status, 'expired')))
	}

	const [marked] = await db
		.update(schema.event)
		.set({ dataDeletedAt: now })
		.where(and(eq(schema.event.id, eventId), isNull(schema.event.dataDeletedAt)))
		.returning({ id: schema.event.id })
	if (marked) {
		const entry = {
			action: 'retention.anonymise',
			subjectType: 'event',
			subjectId: eventId,
			eventId,
			data: { registrations, files: keys.length },
		}
		if (actor) await auditStatement(db, actor, entry)
		else {
			await db
				.insert(schema.auditLog)
				.values({ organizationId: event.organizationId, actorKind: 'system', ...entry })
		}
	}
	return { registrations, files: keys.length }
}

/** "Anonymise now" (journeys.md, O9): the same process, early, by an organizer. */
export async function anonymiseEventNow(
	db: Db,
	files: FileStorage,
	ctx: OrganizerContext,
	eventId: string,
): Promise<Anonymised> {
	requirePermission(ctx, { event: ['delete'] })
	await getEvent(db, ctx, eventId)
	return anonymiseEvent(db, files, eventId, ctx)
}

/** The daily cron: anonymises every due event. One failing event doesn't stop the rest. */
export async function runRetention(db: Db, files: FileStorage, now = new Date()) {
	const done: string[] = []
	const failed: string[] = []
	for (const eventId of await eventsDueForAnonymisation(db, now)) {
		try {
			await anonymiseEvent(db, files, eventId, null, now)
			done.push(eventId)
		} catch (error) {
			console.error('Anonymisation failed', { eventId, error: String(error) })
			failed.push(eventId)
		}
	}
	return { done, failed }
}
