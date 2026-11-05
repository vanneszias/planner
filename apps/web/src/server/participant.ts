import { env } from 'cloudflare:workers'
import { createDb, schema } from '@app/db'
import {
	type BookingResult,
	type CancelResult,
	contextFromCode,
	DomainError,
	findRedirect,
	getPreferences,
	getPublicEvent,
	getRegistration,
	hasPublishedRun,
	minimumRanks,
	type ParticipantContext,
	type Promotion,
	participantExplanation,
	participantPlan,
	publicEventMeta,
	type RankingResult,
	rankableWorkshopIds,
	registerSelf,
	rotateAccessToken,
	type SelfRegistrationInput,
	savePreferences,
	seatCounts,
	utcToZoned,
	type WaitlistResult,
} from '@app/domain'
import { coordinatorFor, r2RunStorage } from '@app/platform'
import { notFound, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { and, eq } from 'drizzle-orm'
import { sendEmail } from './email'
import { newLinkEmail, promotedEmail, registrationEmail } from './participant-emails'
import { readParticipant, setParticipantCookie } from './participant-session'
import { clientIp, withinLimit } from './rate-limit'
import { verifyTurnstile } from './turnstile'

/*
 * Participant-side server functions (journeys.md, P1–P5). Booking writes go
 * through the event's Durable Object; reads come straight from D1.
 */

const db = () => createDb(env.DB)
const coordinator = (eventId: string) =>
	coordinatorFor(env.EVENT_COORDINATOR, env.COORDINATOR_JURISDICTION, eventId)
const linkFor = (token: string) => `${env.BETTER_AUTH_URL}/r/${token}`

/** The event, or a 404: participants only ever act on published events. */
async function eventOr404(eventId: string) {
	const meta = await publicEventMeta(db(), eventId)
	if (!meta) throw notFound()
	return meta
}

async function participantOrNull(eventId: string) {
	const meta = await eventOr404(eventId)
	return { meta, participant: await readParticipant(eventId, meta.organizationId) }
}

async function participantView(participant: ParticipantContext) {
	const registration = await getRegistration(db(), participant)
	const [plan, ranking, rankable, explanation] = await Promise.all([
		participantPlan(db(), participant),
		getPreferences(db(), participant.registrationId),
		rankableWorkshopIds(db(), participant.eventId, participant.registrationId),
		participantExplanation(db(), r2RunStorage(env.FILES), participant),
	])
	return {
		name: registration.displayName,
		ageGroupId: registration.ageGroupId,
		...plan,
		ranking,
		rankable: [...rankable],
		explanation,
	}
}

/** The public page plus, for a recognised participant, their own plan. */
export const getEventPage = createServerFn({ method: 'GET' })
	.validator((input: { org: string; event: string }) => input)
	.handler(async ({ data }) => {
		const page = await getPublicEvent(db(), data.org, data.event)
		if (!page) {
			const moved = await findRedirect(db(), `/${data.org}/${data.event}`)
			if (moved) throw redirect({ href: moved, statusCode: 301 })
			throw notFound()
		}
		const meta = await eventOr404(page.event.id)
		const participant = await readParticipant(page.event.id, meta.organizationId)
		return {
			...page,
			seats: await seatCounts(db(), page.event.id),
			published: await hasPublishedRun(db(), page.event.id),
			turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
			me: participant
				? await participantView(participant).then((view) => ({
						...view,
						// The counter on the ranking screen (D8, D26).
						rules: {
							min: minimumRanks(page.event, view.rankable.length),
							max: Math.min(page.event.rankLimit, view.rankable.length),
						},
					}))
				: null,
		}
	})

type Bot = { turnstileToken?: string }

/** Register (and, from a session's Book button, book it at once: no email round trip, D23). */
export const registerFn = createServerFn({ method: 'POST' })
	.validator(
		(input: { eventId: string; values: SelfRegistrationInput; sessionId?: string } & Bot) => input,
	)
	.handler(async ({ data }) => {
		const meta = await eventOr404(data.eventId)
		if (!(await withinLimit('register', `${clientIp()}:${data.eventId}`)))
			return { ok: false as const, reason: 'busy' as const }
		if (!(await verifyTurnstile(data.turnstileToken)))
			return { ok: false as const, reason: 'bot' as const }

		const result = await registerSelf(db(), data.eventId, data.values).catch((error: unknown) => {
			if (error instanceof DomainError && error.code === 'invalid') {
				return { kind: 'invalid' as const, issues: error.issues ?? {} }
			}
			throw error
		})
		if (result.kind === 'invalid')
			return { ok: false as const, reason: 'invalid' as const, issues: result.issues }

		if (result.kind === 'existing') {
			// Same neutral answer as a new registration; the inbox owner gets a fresh link.
			const token = await rotateAccessToken(db(), result.registrationId)
			await sendEmail(
				newLinkEmail({
					to: data.values.email,
					locale: meta.defaultLocale,
					eventName: meta.name,
					accentColor: meta.accentColor,
					link: linkFor(token),
				}),
			)
			return { ok: true as const, existing: true as const }
		}

		await setParticipantCookie(result.context)
		await sendEmail(
			registrationEmail({
				to: data.values.email,
				locale: meta.defaultLocale,
				name: data.values.name,
				eventName: meta.name,
				accentColor: meta.accentColor,
				link: linkFor(result.credentials.token),
				code: result.credentials.code,
			}),
		)
		const booking: BookingResult | null = data.sessionId
			? await coordinator(data.eventId).book(result.context, data.sessionId)
			: null
		return { ok: true as const, existing: false as const, booking }
	})

/** "I have a code" (P3): the code is swapped for the same cookie a link gives. */
export const enterCodeFn = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string; code: string } & Bot) => input)
	.handler(async ({ data }) => {
		await eventOr404(data.eventId)
		if (!(await withinLimit('code', `${clientIp()}:${data.eventId}`)))
			return { ok: false as const, busy: true }
		if (!(await verifyTurnstile(data.turnstileToken))) return { ok: false as const }
		const context = await contextFromCode(db(), data.eventId, data.code)
		if (!context) return { ok: false as const }
		await setParticipantCookie(context)
		return { ok: true as const }
	})

/** "Find my programme" (P4): always the same answer; the inbox owner gets a fresh link. */
export const findProgrammeFn = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string; email: string } & Bot) => input)
	.handler(async ({ data }) => {
		const meta = await eventOr404(data.eventId)
		if (!(await verifyTurnstile(data.turnstileToken))) return { ok: false as const }
		const email = data.email.trim().toLowerCase()
		// Over the limit: the same answer, but no email (no way to probe or flood an inbox).
		const allowed =
			(await withinLimit('findIp', `${clientIp()}:${data.eventId}`)) &&
			(await withinLimit('findEmail', email))
		if (!allowed) return { ok: true as const }
		const [found] = await db()
			.select({ id: schema.registration.id })
			.from(schema.registration)
			.where(
				and(
					eq(schema.registration.eventId, data.eventId),
					eq(schema.registration.email, email),
					eq(schema.registration.status, 'active'),
				),
			)
			.limit(1)
		if (found) {
			const token = await rotateAccessToken(db(), found.id)
			await sendEmail(
				newLinkEmail({
					to: email,
					locale: meta.defaultLocale,
					eventName: meta.name,
					accentColor: meta.accentColor,
					link: linkFor(token),
				}),
			)
		}
		return { ok: true as const }
	})

async function requireParticipant(eventId: string): Promise<ParticipantContext> {
	const { participant } = await participantOrNull(eventId)
	if (!participant) throw notFound()
	return participant
}

const busy = { ok: false as const, reason: 'busy' as const }
const bookingAllowed = (participant: ParticipantContext) =>
	withinLimit('booking', participant.registrationId)

export const bookFn = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string; sessionId: string }) => input)
	.handler(async ({ data }) => {
		const participant = await requireParticipant(data.eventId)
		if (!(await bookingAllowed(participant))) return busy
		const result: BookingResult = await coordinator(data.eventId).book(participant, data.sessionId)
		return result
	})

export const cancelFn = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string; sessionId: string }) => input)
	.handler(async ({ data }) => {
		const participant = await requireParticipant(data.eventId)
		if (!(await bookingAllowed(participant))) return busy
		const result: CancelResult = await coordinator(data.eventId).cancel(participant, data.sessionId)
		if (result.ok && result.promoted) await notifyPromotions(data.eventId, [result.promoted])
		return result.ok ? { ok: true as const } : result
	})

export const joinWaitlistFn = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string; sessionId: string }) => input)
	.handler(async ({ data }) => {
		const participant = await requireParticipant(data.eventId)
		if (!(await bookingAllowed(participant))) return busy
		const result: WaitlistResult = await coordinator(data.eventId).joinWaitlist(
			participant,
			data.sessionId,
		)
		return result
	})

export const leaveWaitlistFn = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string; sessionId: string }) => input)
	.handler(async ({ data }) => {
		const participant = await requireParticipant(data.eventId)
		if (!(await bookingAllowed(participant))) return busy
		await coordinator(data.eventId).leaveWaitlist(participant, data.sessionId)
		return { ok: true as const }
	})

/** "Not you? Cancel this registration" (D23). */
export const cancelRegistrationFn = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string }) => input)
	.handler(async ({ data }) => {
		const participant = await requireParticipant(data.eventId)
		const promotions: Promotion[] = await coordinator(data.eventId).cancelRegistration(participant)
		await notifyPromotions(data.eventId, promotions)
		return { ok: true as const }
	})

/** Emails everyone who just got a place from a waitlist (P5). */
async function notifyPromotions(eventId: string, promotions: Promotion[]) {
	if (promotions.length === 0) return
	const meta = await eventOr404(eventId)
	for (const promotion of promotions) {
		const [row] = await db()
			.select({
				email: schema.registration.email,
				guardianEmail: schema.registration.guardianEmail,
				workshop: schema.workshop.title,
				startsAt: schema.eventSession.startsAt,
			})
			.from(schema.registration)
			.innerJoin(schema.eventSession, eq(schema.eventSession.id, promotion.sessionId))
			.innerJoin(schema.workshop, eq(schema.workshop.id, schema.eventSession.workshopId))
			.where(eq(schema.registration.id, promotion.registrationId))
			.limit(1)
		const to = row?.email ?? row?.guardianEmail
		if (!row || !to) continue
		const when = utcToZoned(row.startsAt, meta.timezone)
		await sendEmail(
			promotedEmail({
				to,
				locale: meta.defaultLocale,
				eventName: meta.name,
				accentColor: meta.accentColor,
				workshop: row.workshop,
				when: `${when.date} ${when.time}`,
				eventUrl: `${env.BETTER_AUTH_URL}/${meta.organizationSlug}/${meta.slug}`,
			}),
		)
	}
}

/** Saves a participant's ranking (P2). Validation happens in the domain. */
export const savePreferencesFn = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string; workshopIds: string[] }) => input)
	.handler(async ({ data }) => {
		const participant = await requireParticipant(data.eventId)
		if (!(await withinLimit('ranking', participant.registrationId))) return busy
		const result: RankingResult = await savePreferences(db(), participant, data.workshopIds)
		return result
	})
