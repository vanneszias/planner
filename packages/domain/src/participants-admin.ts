import { parseCsv } from '@app/allocation/csv'
import { type Db, schema } from '@app/db'
import { and, asc, count, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { auditStatement } from './audit.ts'
import { type OrganizerContext, requirePermission } from './context.ts'
import { chunk, maxInList } from './d1-limits.ts'
import { invalid } from './errors.ts'
import { getEvent } from './events.ts'
import {
	accessTokenHash,
	newAccessToken,
	newShortCode,
	type SealToken,
	shortCodeHash,
} from './tokens.ts'
import { parse } from './validation.ts'

/*
 * The organizer's side of participants (journeys.md, O4; D2, D16, D24).
 * Viewers may read participant data, so every read is audit-logged (D14).
 */

export async function listParticipants(db: Db, ctx: OrganizerContext, eventId: string) {
	requirePermission(ctx, { participant: ['read'] })
	await getEvent(db, ctx, eventId)
	const [registrations, bookings, waitlist] = await Promise.all([
		db
			.select({
				id: schema.registration.id,
				displayName: schema.registration.displayName,
				email: schema.registration.email,
				guardianEmail: schema.registration.guardianEmail,
				ageGroupId: schema.registration.ageGroupId,
				isMinor: schema.registration.isMinor,
				registeredBy: schema.registration.registeredBy,
				preferencesSubmittedAt: schema.registration.preferencesSubmittedAt,
				createdAt: schema.registration.createdAt,
			})
			.from(schema.registration)
			.where(
				and(
					eq(schema.registration.eventId, eventId),
					eq(schema.registration.organizationId, ctx.organizationId),
					eq(schema.registration.status, 'active'),
				),
			)
			.orderBy(asc(schema.registration.displayName)),
		db
			.select({ registrationId: schema.assignment.registrationId, n: count() })
			.from(schema.assignment)
			.where(eq(schema.assignment.eventId, eventId))
			.groupBy(schema.assignment.registrationId),
		db
			.select({ registrationId: schema.waitlistEntry.registrationId, n: count() })
			.from(schema.waitlistEntry)
			.where(eq(schema.waitlistEntry.eventId, eventId))
			.groupBy(schema.waitlistEntry.registrationId),
	])
	await auditStatement(db, ctx, {
		action: 'participants.list',
		subjectType: 'event',
		subjectId: eventId,
		eventId,
	})
	const booked = new Map(bookings.map((b) => [b.registrationId, b.n]))
	const waiting = new Map(waitlist.map((w) => [w.registrationId, w.n]))
	return registrations.map(({ preferencesSubmittedAt, ...r }) => ({
		...r,
		ranked: preferencesSubmittedAt !== null,
		bookings: booked.get(r.id) ?? 0,
		waitlisted: waiting.get(r.id) ?? 0,
	}))
}

const minorInput = z.object({
	name: z.string().trim().min(1, 'required').max(80, 'too_long'),
	ageGroupId: z.string().optional(),
	guardianEmail: z
		.string()
		.trim()
		.toLowerCase()
		.max(254, 'too_long')
		.pipe(z.email('email'))
		.optional()
		.or(z.literal('').transform(() => undefined)),
})
export type MinorInput = z.input<typeof minorInput>

/** Placeholder credentials: real ones are issued when cards are printed or emailed. */
async function unusedCredentials(eventId: string) {
	return {
		accessTokenHash: await accessTokenHash(newAccessToken()),
		shortCodeHash: await shortCodeHash(eventId, newShortCode()),
	}
}

async function assertAgeGroup(db: Db, eventId: string, ageGroupId: string | undefined) {
	if (!ageGroupId) return
	const [group] = await db
		.select({ id: schema.ageGroup.id })
		.from(schema.ageGroup)
		.where(and(eq(schema.ageGroup.id, ageGroupId), eq(schema.ageGroup.eventId, eventId)))
		.limit(1)
	if (!group) throw invalid({ ageGroupId: 'not_found' })
}

/** Adds a minor by hand (D2): name, age group, optional guardian email. No account, no own email. */
export async function addMinor(db: Db, ctx: OrganizerContext, eventId: string, input: MinorInput) {
	requirePermission(ctx, { participant: ['write'] })
	const values = parse(minorInput, input)
	await getEvent(db, ctx, eventId)
	await assertAgeGroup(db, eventId, values.ageGroupId)
	const [created] = await db
		.insert(schema.registration)
		.values({
			organizationId: ctx.organizationId,
			eventId,
			registeredBy: 'organizer',
			isMinor: true,
			displayName: values.name,
			ageGroupId: values.ageGroupId ?? null,
			guardianEmail: values.guardianEmail ?? null,
			...(await unusedCredentials(eventId)),
		})
		.returning({ id: schema.registration.id })
	await auditStatement(db, ctx, {
		action: 'participants.add',
		subjectType: 'registration',
		subjectId: created?.id ?? '',
		eventId,
	})
	return created?.id
}

export type ImportProblem = { row: number; field: string; code: string }

/**
 * CSV import of minors (O4): columns "name", "age group" (label) and
 * "guardian email". Checks every row first; imports nothing unless all rows
 * are valid, so a half-imported list never happens.
 */
export async function importMinors(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
	csv: string,
	commit: boolean,
): Promise<{ rows: number; problems: ImportProblem[]; imported: number }> {
	requirePermission(ctx, { participant: ['write'] })
	await getEvent(db, ctx, eventId)
	if (csv.length > 1_000_000) throw invalid({ csv: 'too_long' })

	const groups = await db
		.select({ id: schema.ageGroup.id, label: schema.ageGroup.label })
		.from(schema.ageGroup)
		.where(eq(schema.ageGroup.eventId, eventId))
	const groupByLabel = new Map(groups.map((g) => [g.label.trim().toLowerCase(), g.id]))

	const rows = parseCsv(csv)
	const problems: ImportProblem[] = []
	const values = rows.map((row, index) => {
		const line = index + 2 // header is line 1
		const label = (row['age group'] ?? '').trim().toLowerCase()
		const ageGroupId = label ? groupByLabel.get(label) : undefined
		if (label && !ageGroupId) problems.push({ row: line, field: 'age group', code: 'not_found' })
		const parsed = minorInput.safeParse({
			name: row.name ?? '',
			guardianEmail: row['guardian email'] ?? '',
			ageGroupId,
		})
		if (!parsed.success) {
			for (const issue of parsed.error.issues) {
				problems.push({ row: line, field: String(issue.path[0] ?? 'name'), code: issue.message })
			}
			return null
		}
		return parsed.data
	})
	if (rows.length === 0) problems.push({ row: 1, field: 'name', code: 'required' })
	if (rows.length > 5000) problems.push({ row: 1, field: 'csv', code: 'too_many' })
	if (!commit || problems.length > 0) return { rows: rows.length, problems, imported: 0 }

	// One batch: a single D1 query that commits all rows or none.
	const inserts = []
	for (const value of values) {
		if (!value) continue
		inserts.push(
			db.insert(schema.registration).values({
				organizationId: ctx.organizationId,
				eventId,
				registeredBy: 'organizer',
				isMinor: true,
				displayName: value.name,
				ageGroupId: value.ageGroupId ?? null,
				guardianEmail: value.guardianEmail ?? null,
				...(await unusedCredentials(eventId)),
			}),
		)
	}
	const [first, ...rest] = inserts
	if (first) await db.batch([first, ...rest])
	await auditStatement(db, ctx, {
		action: 'participants.import',
		subjectType: 'event',
		subjectId: eventId,
		eventId,
		data: { count: inserts.length },
	})
	return { rows: rows.length, problems, imported: inserts.length }
}

/**
 * Issues fresh links and codes for code cards or guardian emails (D16, D24).
 * Only hashes are stored, so earlier cards and links stop working; the
 * plain credentials exist only in this return value.
 */
export async function issueCredentials(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
	registrationIds: string[],
	seal?: SealToken,
) {
	requirePermission(ctx, { participant: ['write'] })
	await getEvent(db, ctx, eventId)
	if (registrationIds.length === 0) return []
	// D1: at most 100 bound parameters per statement, so look people up in chunks.
	const people = (
		await Promise.all(
			chunk([...new Set(registrationIds)].slice(0, 2000), maxInList).map((ids) =>
				db
					.select({
						id: schema.registration.id,
						displayName: schema.registration.displayName,
						guardianEmail: schema.registration.guardianEmail,
						email: schema.registration.email,
					})
					.from(schema.registration)
					.where(
						and(
							eq(schema.registration.eventId, eventId),
							eq(schema.registration.organizationId, ctx.organizationId),
							eq(schema.registration.status, 'active'),
							inArray(schema.registration.id, ids),
						),
					),
			),
		)
	)
		.flat()
		.sort((a, b) => a.displayName.localeCompare(b.displayName))

	const issued = await Promise.all(
		people.map(async (person) => {
			const token = newAccessToken()
			const code = newShortCode()
			return {
				...person,
				token,
				code,
				accessTokenHash: await accessTokenHash(token),
				accessTokenSealed: seal ? await seal(token) : null,
				shortCodeHash: await shortCodeHash(eventId, code),
			}
		}),
	)
	// One batch per 100 updates: a batch counts as one query against the per-request limit.
	for (const group of chunk(issued, 100)) {
		const [first, ...rest] = group.map((person) =>
			db
				.update(schema.registration)
				.set({
					accessTokenHash: person.accessTokenHash,
					accessTokenSealed: person.accessTokenSealed,
					shortCodeHash: person.shortCodeHash,
				})
				.where(eq(schema.registration.id, person.id)),
		)
		if (first) await db.batch([first, ...rest])
	}
	await auditStatement(db, ctx, {
		action: 'participants.credentials',
		subjectType: 'event',
		subjectId: eventId,
		eventId,
		data: { count: issued.length },
	})
	return issued.map(
		({ accessTokenHash: _a, accessTokenSealed: _e, shortCodeHash: _s, ...person }) => person,
	)
}
