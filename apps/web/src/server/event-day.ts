import { env } from 'cloudflare:workers'
import {
	anonymisationDate,
	anonymiseEventNow,
	type CheckInCounts,
	type CheckInResult,
	can,
	checkInOverview,
	checkInRoster,
	credentialFromScan,
	type ExportKind,
	type ExportMessage,
	exportForDownload,
	getEvent,
	listExports,
	listSessions,
	requestExport,
	signExportLink,
} from '@app/domain'
import { coordinatorFor, r2Files } from '@app/platform'
import { createServerFn } from '@tanstack/react-start'
import { action, limitBulk, requireFreshSignIn, requireOrganizer } from './organizer'

/* Event day (journeys.md, O8 and O9): check-in, exports, anonymisation. */

const coordinator = (eventId: string) =>
	coordinatorFor(env.EVENT_COORDINATOR, env.COORDINATOR_JURISDICTION, eventId)

/** Sessions with their counts, for the check-in screen. Counts only: no names here. */
export const getCheckInFn = createServerFn({ method: 'GET' })
	.validator((eventId: string) => eventId)
	.handler(async ({ data: eventId }) => {
		const { db, ctx } = await requireOrganizer()
		const [event, sessions, counts] = await Promise.all([
			getEvent(db, ctx, eventId),
			listSessions(db, ctx, eventId),
			checkInOverview(db, ctx, eventId),
		])
		return {
			timezone: event.timezone,
			anonymised: event.dataDeletedAt !== null,
			sessions: sessions
				.filter((s) => s.status === 'scheduled')
				.map((s) => ({
					id: s.id,
					workshopId: s.workshopId,
					workshopTitle: s.workshopTitle,
					markerColor: s.markerColor,
					markerShape: s.markerShape,
					room: s.room,
					startsAt: s.startsAt.getTime(),
					endsAt: s.endsAt.getTime(),
					capacity: s.capacity,
				})),
			counts: counts as CheckInCounts,
			canCheckIn: can(ctx, { participant: ['write'] }),
		}
	})

/** Who's expected, for name search and the printable list. Audit-logged in the domain. */
export const getRosterFn = createServerFn({ method: 'GET' })
	.validator((input: { eventId: string; sessionId: string | null }) => input)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return checkInRoster(db, ctx, data.eventId, data.sessionId)
	})

/**
 * Checks someone in from a scan, a typed code or a picked name. Goes through
 * the event's Durable Object, which tells the other check-in screens.
 */
export const checkInFn = createServerFn({ method: 'POST' })
	.validator(
		(input: {
			eventId: string
			sessionId: string | null
			scan?: string
			registrationId?: string
			force?: boolean
		}) => input,
	)
	.handler(async ({ data }) => {
		const { ctx } = await requireOrganizer()
		return action(async (): Promise<CheckInResult> => {
			const credential = data.registrationId
				? { registrationId: data.registrationId }
				: credentialFromScan(data.scan ?? '')
			if (!credential) return { ok: false, reason: 'unknown' }
			return coordinator(data.eventId).checkIn(ctx, data.eventId, {
				sessionId: data.sessionId,
				credential,
				force: data.force,
			})
		})
	})

export const undoCheckInFn = createServerFn({ method: 'POST' })
	.validator(
		(input: { eventId: string; sessionId: string | null; registrationId: string }) => input,
	)
	.handler(async ({ data }) => {
		const { ctx } = await requireOrganizer()
		return action(() =>
			coordinator(data.eventId).undoCheckIn(ctx, data.eventId, data.sessionId, data.registrationId),
		)
	})

export const getExportsFn = createServerFn({ method: 'GET' })
	.validator((eventId: string) => eventId)
	.handler(async ({ data: eventId }) => {
		const { db, ctx } = await requireOrganizer()
		if (!can(ctx, { participant: ['export'] })) return []
		const exports = await listExports(db, ctx, eventId)
		return exports.map((e) => ({
			...e,
			createdAt: e.createdAt.getTime(),
			expiresAt: e.expiresAt.getTime(),
		}))
	})

/** Asks the jobs Worker for a CSV (O9); the screen polls until it's ready. */
export const requestExportFn = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string; kind: ExportKind }) => input)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return action(async () => {
			await limitBulk(ctx)
			const job = await requestExport(db, ctx, data.eventId, data.kind)
			await env.JOBS.send({ kind: 'export', exportId: job.id } satisfies ExportMessage)
			return job.id
		})
	})

/** A 15-minute signed link to the file on the api Worker, after the session check. */
export const exportLinkFn = createServerFn({ method: 'POST' })
	.validator((exportId: string) => exportId)
	.handler(async ({ data: exportId }) => {
		const { db, ctx } = await requireOrganizer()
		return action(async () => {
			const job = await exportForDownload(db, ctx, exportId)
			const { expires, signature } = await signExportLink(env.EXPORT_SIGNING_KEY, job.id)
			return `${env.API_URL}/exports/${job.id}?expires=${expires}&signature=${signature}`
		})
	})

/** When the event's participant data goes, for the overview (D6, D20). */
export const getRetentionFn = createServerFn({ method: 'GET' })
	.validator((eventId: string) => eventId)
	.handler(async ({ data: eventId }) => {
		const { db, ctx } = await requireOrganizer()
		const event = await getEvent(db, ctx, eventId)
		return {
			date: anonymisationDate(event),
			doneAt: event.dataDeletedAt?.getTime() ?? null,
			canAnonymise: can(ctx, { event: ['delete'] }),
		}
	})

/** "Anonymise now" (O9): needs a recent sign-in. */
export const anonymiseNowFn = createServerFn({ method: 'POST' })
	.validator((eventId: string) => eventId)
	.handler(async ({ data: eventId }) => {
		const { db, ctx } = await requireOrganizer()
		return action(async () => {
			await requireFreshSignIn()
			return anonymiseEventNow(db, r2Files(env.FILES), ctx, eventId)
		})
	})
