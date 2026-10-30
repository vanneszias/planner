import { toCsv } from '@app/allocation/csv'
import { type Db, schema } from '@app/db'
import { and, asc, desc, eq, inArray, lt, ne } from 'drizzle-orm'
import { auditStatement } from './audit.ts'
import { type OrganizerContext, requirePermission } from './context.ts'
import { invalid, notFound } from './errors.ts'
import { getEvent } from './events.ts'
import type { FileStorage } from './files.ts'
import { utcToZoned } from './time.ts'

/*
 * CSV exports (journeys.md, O9): participants, programmes and attendance.
 * The organizer asks, the jobs Worker builds the file into R2, and the api
 * Worker serves it through a 15-minute signed link (security-privacy.md).
 * Files hold personal data, so they expire after 7 days.
 */

export type ExportKind = (typeof schema.exportKinds)[number]
export type ExportJob = typeof schema.exportJob.$inferSelect

export const exportLifetimeMs = 7 * 24 * 60 * 60 * 1000
export const downloadLinkMs = 15 * 60 * 1000

/** The queue message that asks the jobs Worker to build an export. */
export type ExportMessage = { kind: 'export'; exportId: string }

export async function requestExport(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
	kind: ExportKind,
	now = new Date(),
): Promise<ExportJob> {
	requirePermission(ctx, { participant: ['export'] })
	if (!schema.exportKinds.includes(kind)) throw invalid({ kind: 'not_found' })
	await getEvent(db, ctx, eventId)
	const [job] = await db
		.insert(schema.exportJob)
		.values({
			organizationId: ctx.organizationId,
			eventId,
			kind,
			requestedBy: ctx.userId,
			createdAt: now,
			expiresAt: new Date(now.getTime() + exportLifetimeMs),
		})
		.returning()
	if (!job) throw new Error('Export insert returned nothing')
	await auditStatement(db, ctx, {
		action: 'export.request',
		subjectType: 'export_job',
		subjectId: job.id,
		eventId,
		data: { kind },
	})
	return job
}

/** Recent exports for the event's export panel, newest first. */
export async function listExports(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
	now = new Date(),
) {
	requirePermission(ctx, { participant: ['export'] })
	await getEvent(db, ctx, eventId)
	const rows = await db
		.select({
			id: schema.exportJob.id,
			kind: schema.exportJob.kind,
			status: schema.exportJob.status,
			rows: schema.exportJob.rows,
			createdAt: schema.exportJob.createdAt,
			expiresAt: schema.exportJob.expiresAt,
		})
		.from(schema.exportJob)
		.where(
			and(
				eq(schema.exportJob.eventId, eventId),
				eq(schema.exportJob.organizationId, ctx.organizationId),
				ne(schema.exportJob.status, 'expired'),
			),
		)
		.orderBy(desc(schema.exportJob.createdAt))
		.limit(20)
	return rows.filter((r) => r.expiresAt > now)
}

/** A ready export the organizer may download; audit-logged as a read of participant data. */
export async function exportForDownload(
	db: Db,
	ctx: OrganizerContext,
	exportId: string,
	now = new Date(),
): Promise<ExportJob> {
	requirePermission(ctx, { participant: ['export'] })
	const [job] = await db
		.select()
		.from(schema.exportJob)
		.where(
			and(
				eq(schema.exportJob.id, exportId),
				eq(schema.exportJob.organizationId, ctx.organizationId),
			),
		)
		.limit(1)
	if (job?.status !== 'ready' || !job.r2Key || job.expiresAt <= now) {
		throw notFound('Export')
	}
	await auditStatement(db, ctx, {
		action: 'export.download',
		subjectType: 'export_job',
		subjectId: job.id,
		eventId: job.eventId,
		data: { kind: job.kind },
	})
	return job
}

const headers = {
	en: {
		name: 'Name',
		ageGroup: 'Age group',
		minor: 'Minor',
		email: 'Email',
		guardianEmail: 'Guardian email',
		registeredBy: 'Registered by',
		registeredAt: 'Registered at',
		places: 'Places',
		ranked: 'Ranked',
		checkedIn: 'Checked in',
		date: 'Date',
		start: 'Start',
		end: 'End',
		workshop: 'Workshop',
		room: 'Room',
		capacity: 'Places in session',
		source: 'How',
		yes: 'yes',
		no: 'no',
		self: 'themselves',
		guardian: 'guardian',
		organizer: 'organizer',
		booking: 'booked',
		allocation: 'allocated',
		manual: 'by organizer',
	},
	nl: {
		name: 'Naam',
		ageGroup: 'Leeftijdsgroep',
		minor: 'Minderjarig',
		email: 'E-mail',
		guardianEmail: 'E-mail ouder',
		registeredBy: 'Ingeschreven door',
		registeredAt: 'Ingeschreven op',
		places: 'Plaatsen',
		ranked: 'Voorkeuren',
		checkedIn: 'Aangemeld',
		date: 'Datum',
		start: 'Begin',
		end: 'Einde',
		workshop: 'Workshop',
		room: 'Lokaal',
		capacity: 'Plaatsen in sessie',
		source: 'Hoe',
		yes: 'ja',
		no: 'nee',
		self: 'zichzelf',
		guardian: 'ouder',
		organizer: 'organisator',
		booking: 'geboekt',
		allocation: 'toegewezen',
		manual: 'door organisator',
	},
} as const

/**
 * Builds a pending export into storage (jobs Worker). Idempotent: a
 * redelivered message for a finished export does nothing. The job row is
 * the authority here: it was created after an organizer permission check.
 */
export async function runExport(
	db: Db,
	files: FileStorage,
	exportId: string,
): Promise<'built' | 'skipped'> {
	const [job] = await db
		.select()
		.from(schema.exportJob)
		.where(eq(schema.exportJob.id, exportId))
		.limit(1)
	if (job?.status !== 'pending') return 'skipped'
	const [event] = await db
		.select()
		.from(schema.event)
		.where(eq(schema.event.id, job.eventId))
		.limit(1)
	if (!event) return 'skipped'

	const rows = await exportRows(db, event, job.kind)
	// Dutch spreadsheets expect semicolons; the BOM makes Excel read UTF-8.
	const csv = `﻿${toCsv(rows, event.defaultLocale === 'nl' ? ';' : ',')}`
	const key = `exports/${job.organizationId}/${job.id}.csv`
	await files.putText(key, csv, 'text/csv; charset=utf-8')
	await db
		.update(schema.exportJob)
		.set({ status: 'ready', r2Key: key, rows: rows.length - 1 })
		.where(eq(schema.exportJob.id, job.id))
	return 'built'
}

/** Marks an export failed after the queue gives up on it. */
export async function failExport(db: Db, exportId: string): Promise<void> {
	await db
		.update(schema.exportJob)
		.set({ status: 'failed' })
		.where(and(eq(schema.exportJob.id, exportId), eq(schema.exportJob.status, 'pending')))
}

export function exportFilename(eventSlug: string, kind: ExportKind, createdAt: Date): string {
	return `${eventSlug}-${kind}-${createdAt.toISOString().slice(0, 10)}.csv`
}

type Cell = string | number | null
type EventRow = typeof schema.event.$inferSelect

async function exportRows(db: Db, event: EventRow, kind: ExportKind): Promise<Cell[][]> {
	const t = headers[event.defaultLocale]
	const zoned = (at: Date | null) => (at ? utcToZoned(at, event.timezone) : null)
	const stamp = (at: Date | null) => {
		const z = zoned(at)
		return z ? `${z.date} ${z.time}` : ''
	}

	if (kind === 'participants') {
		const [people, places] = await Promise.all([
			db
				.select({
					id: schema.registration.id,
					name: schema.registration.displayName,
					ageGroup: schema.ageGroup.label,
					isMinor: schema.registration.isMinor,
					email: schema.registration.email,
					guardianEmail: schema.registration.guardianEmail,
					registeredBy: schema.registration.registeredBy,
					createdAt: schema.registration.createdAt,
					ranked: schema.registration.preferencesSubmittedAt,
					checkedInAt: schema.registration.checkedInAt,
				})
				.from(schema.registration)
				.leftJoin(schema.ageGroup, eq(schema.ageGroup.id, schema.registration.ageGroupId))
				.where(
					and(eq(schema.registration.eventId, event.id), eq(schema.registration.status, 'active')),
				)
				.orderBy(asc(schema.registration.displayName)),
			placesByPerson(db, event.id),
		])
		const ranking = event.mode === 'ranking'
		return [
			[
				t.name,
				t.ageGroup,
				t.minor,
				t.email,
				t.guardianEmail,
				t.registeredBy,
				t.registeredAt,
				t.places,
				...(ranking ? [t.ranked] : []),
				t.checkedIn,
			],
			...people.map((p) => [
				p.name,
				p.ageGroup,
				p.isMinor ? t.yes : t.no,
				p.email,
				p.guardianEmail,
				t[p.registeredBy],
				stamp(p.createdAt),
				places.get(p.id) ?? 0,
				...(ranking ? [p.ranked ? t.yes : t.no] : []),
				stamp(p.checkedInAt),
			]),
		]
	}

	const places = await db
		.select({
			name: schema.registration.displayName,
			ageGroup: schema.ageGroup.label,
			workshop: schema.workshop.title,
			room: schema.location.name,
			startsAt: schema.eventSession.startsAt,
			endsAt: schema.eventSession.endsAt,
			capacity: schema.eventSession.capacity,
			source: schema.assignment.source,
			checkedInAt: schema.assignment.checkedInAt,
		})
		.from(schema.assignment)
		.innerJoin(schema.registration, eq(schema.registration.id, schema.assignment.registrationId))
		.innerJoin(schema.eventSession, eq(schema.eventSession.id, schema.assignment.sessionId))
		.innerJoin(schema.workshop, eq(schema.workshop.id, schema.eventSession.workshopId))
		.leftJoin(schema.location, eq(schema.location.id, schema.eventSession.locationId))
		.leftJoin(schema.ageGroup, eq(schema.ageGroup.id, schema.registration.ageGroupId))
		.where(eq(schema.assignment.eventId, event.id))

	const time = (at: Date) => zoned(at)?.time ?? ''
	const date = (at: Date) => zoned(at)?.date ?? ''
	if (kind === 'programmes') {
		places.sort(
			(a, b) => a.name.localeCompare(b.name) || a.startsAt.getTime() - b.startsAt.getTime(),
		)
		return [
			[t.name, t.ageGroup, t.date, t.start, t.end, t.workshop, t.room, t.source, t.checkedIn],
			...places.map((p) => [
				p.name,
				p.ageGroup,
				date(p.startsAt),
				time(p.startsAt),
				time(p.endsAt),
				p.workshop,
				p.room,
				t[p.source],
				stamp(p.checkedInAt),
			]),
		]
	}

	places.sort(
		(a, b) =>
			a.startsAt.getTime() - b.startsAt.getTime() ||
			a.workshop.localeCompare(b.workshop) ||
			a.name.localeCompare(b.name),
	)
	return [
		[t.date, t.start, t.end, t.workshop, t.room, t.capacity, t.name, t.ageGroup, t.checkedIn],
		...places.map((p) => [
			date(p.startsAt),
			time(p.startsAt),
			time(p.endsAt),
			p.workshop,
			p.room,
			p.capacity,
			p.name,
			p.ageGroup,
			stamp(p.checkedInAt),
		]),
	]
}

async function placesByPerson(db: Db, eventId: string): Promise<Map<string, number>> {
	const rows = await db
		.select({ id: schema.assignment.registrationId })
		.from(schema.assignment)
		.where(eq(schema.assignment.eventId, eventId))
	const counts = new Map<string, number>()
	for (const { id } of rows) counts.set(id, (counts.get(id) ?? 0) + 1)
	return counts
}

/**
 * Deletes expired export files and marks their rows (daily cron). Pending or
 * failed jobs past their expiry are closed too. Chunked: 90 rows per round.
 */
export async function expireExports(db: Db, files: FileStorage, now = new Date()) {
	let expired = 0
	for (;;) {
		const due = await db
			.select({ id: schema.exportJob.id, r2Key: schema.exportJob.r2Key })
			.from(schema.exportJob)
			.where(and(ne(schema.exportJob.status, 'expired'), lt(schema.exportJob.expiresAt, now)))
			.limit(90)
		if (due.length === 0) return expired
		await files.delete(due.flatMap((d) => (d.r2Key ? [d.r2Key] : [])))
		await db
			.update(schema.exportJob)
			.set({ status: 'expired', r2Key: null })
			.where(
				inArray(
					schema.exportJob.id,
					due.map((d) => d.id),
				),
			)
		expired += due.length
	}
}

/*
 * Download links (security-privacy.md, "api Worker"): `web` checks the
 * organizer and signs a link; `api` checks the signature and expiry and
 * streams the file. Both share EXPORT_SIGNING_KEY.
 */

async function hmac(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	)
	const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
	return btoa(String.fromCharCode(...new Uint8Array(mac)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '')
}

export async function signExportLink(
	secret: string,
	exportId: string,
	now = Date.now(),
): Promise<{ expires: number; signature: string }> {
	const expires = now + downloadLinkMs
	return { expires, signature: await hmac(secret, `export:${exportId}:${expires}`) }
}

export async function verifyExportLink(
	secret: string,
	exportId: string,
	expires: number,
	signature: string,
	now = Date.now(),
): Promise<boolean> {
	if (!secret || !Number.isFinite(expires) || expires < now) return false
	if (expires > now + downloadLinkMs) return false
	const expected = await hmac(secret, `export:${exportId}:${expires}`)
	if (expected.length !== signature.length) return false
	let diff = 0
	for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
	return diff === 0
}

/** A ready export's file, for the api Worker after it checked the signed link. */
export async function exportFile(
	db: Db,
	exportId: string,
	now = new Date(),
): Promise<{ r2Key: string; filename: string } | null> {
	const [job] = await db
		.select({
			r2Key: schema.exportJob.r2Key,
			status: schema.exportJob.status,
			kind: schema.exportJob.kind,
			createdAt: schema.exportJob.createdAt,
			expiresAt: schema.exportJob.expiresAt,
			eventSlug: schema.event.slug,
		})
		.from(schema.exportJob)
		.innerJoin(schema.event, eq(schema.event.id, schema.exportJob.eventId))
		.where(eq(schema.exportJob.id, exportId))
		.limit(1)
	if (!job?.r2Key || job.status !== 'ready' || job.expiresAt <= now) return null
	return { r2Key: job.r2Key, filename: exportFilename(job.eventSlug, job.kind, job.createdAt) }
}
