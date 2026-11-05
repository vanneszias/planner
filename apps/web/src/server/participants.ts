import { env } from 'cloudflare:workers'
import {
	addMinor,
	can,
	getEvent,
	importMinors,
	issueCredentials,
	listAgeGroups,
	listParticipants,
	type MinorInput,
	type RankingResult,
	rankingFor,
	setPreferencesFor,
} from '@app/domain'
import { createServerFn } from '@tanstack/react-start'
import { renderSVG } from 'uqr'
import { sendEmails } from './email'
import { action, limitBulk, requireOrganizer } from './organizer'
import { guardianLinkEmail } from './participant-emails'

/* The organizer's participant screens (journeys.md, O4). */

const linkFor = (token: string) => `${env.BETTER_AUTH_URL}/r/${token}`

export const getParticipantsFn = createServerFn({ method: 'GET' })
	.validator((eventId: string) => eventId)
	.handler(async ({ data: eventId }) => {
		const { db, ctx } = await requireOrganizer()
		const [participants, ageGroups] = await Promise.all([
			listParticipants(db, ctx, eventId),
			listAgeGroups(db, ctx, eventId),
		])
		return {
			participants,
			ageGroups,
			canWrite: can(ctx, { participant: ['write'] }),
			canExport: can(ctx, { participant: ['export'] }),
		}
	})

export const addMinorFn = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string; values: MinorInput }) => input)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return action(() => addMinor(db, ctx, data.eventId, data.values))
	})

export const importMinorsFn = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string; csv: string; commit: boolean }) => input)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return action(async () => {
			if (data.commit) await limitBulk(ctx)
			return importMinors(db, ctx, data.eventId, data.csv, data.commit)
		})
	})

/**
 * Code cards (D16): fresh link and code per person, the link as a QR code.
 * Rendered on the server so the QR library stays out of the browser bundle.
 */
export const issueCardsFn = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string; registrationIds: string[] }) => input)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return action(async () => {
			await limitBulk(ctx)
			const issued = await issueCredentials(db, ctx, data.eventId, data.registrationIds)
			return issued.map((person) => ({
				id: person.id,
				// First name only on the card: it may be pinned up or lost.
				firstName: person.displayName.split(' ')[0] ?? person.displayName,
				code: person.code,
				qr: renderSVG(linkFor(person.token), { pixelSize: 4, border: 1 }),
			}))
		})
	})

/** Emails each guardian their child's private link (D24). Skips people without a guardian email. */
export const emailGuardiansFn = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string; registrationIds: string[] }) => input)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return action(async () => {
			await limitBulk(ctx)
			const event = await getEvent(db, ctx, data.eventId)
			const people = await listParticipants(db, ctx, data.eventId)
			const withGuardian = people.filter(
				(p) => data.registrationIds.includes(p.id) && p.guardianEmail,
			)
			const issued = await issueCredentials(
				db,
				ctx,
				data.eventId,
				withGuardian.map((p) => p.id),
			)
			await sendEmails(
				issued.flatMap((person) =>
					person.guardianEmail
						? [
								guardianLinkEmail({
									to: person.guardianEmail,
									locale: event.defaultLocale,
									name: person.displayName,
									eventName: event.name,
									accentColor: event.accentColor,
									link: linkFor(person.token),
									code: person.code,
								}),
							]
						: [],
				),
			)
			return { sent: issued.length, skipped: data.registrationIds.length - issued.length }
		})
	})

/** An organizer enters a ranking for someone who doesn't (D16 fallback). */
export const getRankingForFn = createServerFn({ method: 'GET' })
	.validator((input: { eventId: string; registrationId: string }) => input)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return action(() => rankingFor(db, ctx, data.eventId, data.registrationId))
	})

export const setRankingForFn = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string; registrationId: string; workshopIds: string[] }) => input)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return action(
			async (): Promise<RankingResult> =>
				setPreferencesFor(db, ctx, data.eventId, data.registrationId, data.workshopIds),
		)
	})
