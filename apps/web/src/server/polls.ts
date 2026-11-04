import { brand } from '@app/brand'
import {
	type CreatePollInput,
	can,
	cancelPoll,
	confirmPoll,
	createPoll,
	DomainError,
	deletePoll,
	deletePollGroup,
	getPollOverview,
	groupMembers,
	listMembers,
	listPollGroups,
	listPolls,
	type PollGroupInput,
	pollInviteEmail,
	reopenPoll,
	savePollGroup,
	type UpdatePollInput,
	updatePoll,
	utcToZoned,
} from '@app/domain'
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { sendEmails } from './email'
import { action, limitBulk, requireOrganizer } from './organizer'
import { notifyPoll, pollLink, sendPollOutcome } from './poll-notify'

/*
 * Organizer-side poll server functions (docs/availability-polls.md). The
 * domain checks roles and scopes every query to the organization.
 */

export const getPollsDashboard = createServerFn({ method: 'GET' }).handler(async () => {
	const { db, ctx } = await requireOrganizer()
	const [polls, groups] = await Promise.all([listPolls(db, ctx), listPollGroups(db, ctx)])
	return { polls, groups, canCreate: can(ctx, { event: ['create'] }) }
})

export const getPollGroups = createServerFn({ method: 'GET' }).handler(async () => {
	const { db, ctx } = await requireOrganizer()
	const [groups, members] = await Promise.all([listPollGroups(db, ctx), listMembers(db, ctx)])
	return {
		groups,
		members: members.map(({ userId, name, email }) => ({ userId, name, email })),
		canEdit: can(ctx, { event: ['update'] }),
	}
})

export const createPollFn = createServerFn({ method: 'POST' })
	.validator((input: CreatePollInput) => input)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return action(async () => {
			if (data.groupId) await limitBulk(ctx)
			const poll = await createPoll(db, ctx, data)
			if (poll.groupId) {
				// Everyone in the group except whoever is sending it.
				const members = (await groupMembers(db, ctx, poll.groupId)).filter(
					(member) => member.userId !== ctx.userId,
				)
				const organizer = members.length
					? (await listMembers(db, ctx)).find((member) => member.userId === ctx.userId)
					: null
				const deadline = poll.deadlineAt ? utcToZoned(poll.deadlineAt, poll.timezone) : null
				await sendEmails(
					members.map((member) =>
						pollInviteEmail({
							to: member.email,
							locale: poll.locale,
							appName: brand.name,
							organizerName: organizer?.name || brand.name,
							title: poll.title,
							link: pollLink(poll),
							deadline: deadline && `${deadline.date} ${deadline.time}`,
						}),
					),
				)
			}
			return { id: poll.id }
		})
	})

/** Everything the poll screen needs in one round trip. */
export const getPollAdmin = createServerFn({ method: 'GET' })
	.validator((pollId: string) => pollId)
	.handler(async ({ data: pollId }) => {
		const { db, ctx } = await requireOrganizer()
		const overview = await getPollOverview(db, ctx, pollId).catch((error) => {
			if (error instanceof DomainError && error.code === 'not_found') throw notFound()
			throw error
		})
		return {
			...overview,
			link: pollLink(overview.poll),
			canEdit: can(ctx, { event: ['update'] }),
			canDelete: can(ctx, { event: ['delete'] }),
		}
	})

export const updatePollFn = createServerFn({ method: 'POST' })
	.validator((input: { pollId: string; values: UpdatePollInput }) => input)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return action(async () => {
			await updatePoll(db, ctx, data.pollId, data.values)
			await notifyPoll(data.pollId)
		})
	})

export const confirmPollFn = createServerFn({ method: 'POST' })
	.validator((input: { pollId: string; startsAt: number }) => input)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return action(async () => {
			const poll = await confirmPoll(db, ctx, data.pollId, data.startsAt)
			await sendPollOutcome(db, poll)
			await notifyPoll(poll.id)
		})
	})

export const pollStatusFn = createServerFn({ method: 'POST' })
	.validator((input: { pollId: string; to: 'open' | 'cancelled' }) => input)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return action(async () => {
			if (data.to === 'open') await reopenPoll(db, ctx, data.pollId)
			else await cancelPoll(db, ctx, data.pollId)
			await notifyPoll(data.pollId)
		})
	})

export const deletePollFn = createServerFn({ method: 'POST' })
	.validator((pollId: string) => pollId)
	.handler(async ({ data: pollId }) => {
		const { db, ctx } = await requireOrganizer()
		return action(async () => {
			await deletePoll(db, ctx, pollId)
			await notifyPoll(pollId)
		})
	})

export const savePollGroupFn = createServerFn({ method: 'POST' })
	.validator((input: { groupId: string | null; values: PollGroupInput }) => input)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return action(() => savePollGroup(db, ctx, data.groupId, data.values))
	})

export const deletePollGroupFn = createServerFn({ method: 'POST' })
	.validator((groupId: string) => groupId)
	.handler(async ({ data: groupId }) => {
		const { db, ctx } = await requireOrganizer()
		return action(() => deletePollGroup(db, ctx, groupId))
	})
