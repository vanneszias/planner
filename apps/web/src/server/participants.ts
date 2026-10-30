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
} from '@app/domain'
import { createServerFn } from '@tanstack/react-start'
import { renderSVG } from 'uqr'
import { sendEmail } from './email'
import { action, requireOrganizer } from './organizer'
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
		return { participants, ageGroups, canWrite: can(ctx, { participant: ['write'] }) }
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
		return action(() => importMinors(db, ctx, data.eventId, data.csv, data.commit))
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
			for (const person of issued) {
				if (!person.guardianEmail) continue
				await sendEmail(
					guardianLinkEmail({
						to: person.guardianEmail,
						locale: event.defaultLocale,
						name: person.displayName,
						eventName: event.name,
						link: linkFor(person.token),
						code: person.code,
					}),
				)
			}
			return { sent: issued.length, skipped: data.registrationIds.length - issued.length }
		})
	})
