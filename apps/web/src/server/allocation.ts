import { env } from 'cloudflare:workers'
import { schema } from '@app/db'
import {
	chunk,
	claimEmails,
	createDraftRun,
	fillEmptyPlaces,
	getEvent,
	getOrganization,
	listParticipants,
	listRuns,
	maxInList,
	moveInRun,
	publishPreview,
	rankingProgress,
	reviewRun,
} from '@app/domain'
import { coordinatorFor, r2RunStorage } from '@app/platform'
import { createServerFn } from '@tanstack/react-start'
import { inArray } from 'drizzle-orm'
import { sendEmails } from './email'
import { action, requireOrganizer } from './organizer'
import { programmeReadyEmail } from './participant-emails'

/* The organizer's allocation screen (journeys.md, O6). */

const storage = () => r2RunStorage(env.FILES)

/** Progress, runs, and the review of the newest draft or published run. */
export const getAllocationFn = createServerFn({ method: 'GET' })
	.validator((eventId: string) => eventId)
	.handler(async ({ data: eventId }) => {
		const { db, ctx } = await requireOrganizer()
		const [progress, runs, people] = await Promise.all([
			rankingProgress(db, ctx, eventId),
			listRuns(db, ctx, eventId),
			listParticipants(db, ctx, eventId),
		])
		const current =
			runs.find((r) => r.status === 'draft') ?? runs.find((r) => r.status === 'published')
		const review = current ? await reviewRun(db, storage(), ctx, current.id) : null
		return {
			progress,
			hasPublished: runs.some((r) => r.status === 'published'),
			names: Object.fromEntries(people.map((p) => [p.id, p.displayName])),
			review: review && {
				run: {
					id: review.run.id,
					status: review.run.status,
					strategy: review.run.strategy,
					createdAt: review.run.createdAt,
					publishedAt: review.run.publishedAt,
				},
				people: review.people,
				sessionsTaken: review.sessionsTaken,
				metrics: review.metrics,
				warnings: review.warnings,
			},
		}
	})

export const runDraftFn = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string; strategy: 'take-turns' | 'early-birds' }) => input)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return action(async () => (await createDraftRun(db, storage(), ctx, data.eventId, data)).id)
	})

export const moveFn = createServerFn({ method: 'POST' })
	.validator(
		(input: {
			runId: string
			registrationId: string
			fromSessionId?: string
			toSessionId?: string
		}) => input,
	)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return action(() => moveInRun(db, storage(), ctx, data.runId, data))
	})

/** "Fill all empty places" (D27): a new draft keeping every current place. */
export const fillEmptyFn = createServerFn({ method: 'POST' })
	.validator((runId: string) => runId)
	.handler(async ({ data: runId }) => {
		const { db, ctx } = await requireOrganizer()
		return action(async () => (await fillEmptyPlaces(db, storage(), ctx, runId)).id)
	})

export const publishPreviewFn = createServerFn({ method: 'POST' })
	.validator((runId: string) => runId)
	.handler(async ({ data: runId }) => {
		const { db, ctx } = await requireOrganizer()
		return action(() => publishPreview(db, storage(), ctx, runId))
	})

/** Publishes through the event's Durable Object, then emails each participant once. */
export const publishFn = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string; runId: string }) => input)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return action(async () => {
			const event = await getEvent(db, ctx, data.eventId)
			const preview = await publishPreview(db, storage(), ctx, data.runId)
			const published: { registrationIds: string[] } = await coordinatorFor(
				env.EVENT_COORDINATOR,
				env.COORDINATOR_JURISDICTION,
				data.eventId,
			).publish(ctx, data.eventId, data.runId)

			const organization = await getOrganization(db, ctx.organizationId)
			const eventUrl = `${env.BETTER_AUTH_URL}/${organization?.slug}/${event.slug}`
			const people = (
				await Promise.all(
					chunk(published.registrationIds, maxInList).map((ids) =>
						db
							.select({
								id: schema.registration.id,
								name: schema.registration.displayName,
								email: schema.registration.email,
								guardianEmail: schema.registration.guardianEmail,
							})
							.from(schema.registration)
							.where(inArray(schema.registration.id, ids)),
					),
				)
			).flat()
			const reachable = people.flatMap((p) => {
				const to = p.email ?? p.guardianEmail
				return to ? [{ ...p, to, key: `allocation-published:${data.runId}:${p.id}` }] : []
			})
			const claimed = await claimEmails(
				db,
				reachable.map((p) => ({
					organizationId: ctx.organizationId,
					eventId: event.id,
					registrationId: p.id,
					kind: 'allocation-published',
					key: p.key,
				})),
			)
			const emails = reachable
				.filter((p) => claimed.has(p.key))
				.map((p) =>
					programmeReadyEmail({
						to: p.to,
						locale: event.defaultLocale,
						name: p.name,
						eventName: event.name,
						eventUrl,
						changed: !preview.firstPublish,
					}),
				)
			await sendEmails(emails)
			return { sent: emails.length }
		})
	})
