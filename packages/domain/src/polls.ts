import { type Db, schema, uuidv7 } from '@app/db'
import { and, asc, count, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { auditStatement } from './audit.ts'
import { type OrganizerContext, requirePermission } from './context.ts'
import { claimEmails } from './emails.ts'
import { DomainError, invalid, notFound } from './errors.ts'
import {
	formatPollWindow,
	type PollEmail,
	pollConfirmedEmail,
	pollNeedsDecisionEmail,
} from './poll-emails.ts'
import {
	type Availability,
	attendance,
	cellMinutes,
	cleanAvailability,
	rankWindows,
	timeToMinutes,
} from './poll-grid.ts'
import { isValidTimeZone, zonedToUtc } from './time.ts'
import { newAccessToken, sha256 } from './tokens.ts'
import { parse } from './validation.ts'

/*
 * Availability polls (docs/availability-polls.md). Organizer actions take an
 * OrganizerContext and reuse the event permissions: whoever may create or
 * change events may do the same with polls. Respondents reach a poll through
 * its share code and need no account.
 */

export type Poll = typeof schema.poll.$inferSelect

/** The longest grid: a month of evenings. */
export const maxPollDays = 31

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date')
const halfHour = z.string().refine((t) => {
	const minutes = timeToMinutes(t)
	return minutes !== null && minutes % cellMinutes === 0
}, 'time')
const moment = z.object({ date, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time') })

const settingsFields = {
	title: z.string().trim().min(1, 'required').max(120, 'too_long'),
	description: z.string().trim().max(2000, 'too_long'),
	location: z.string().trim().max(200, 'too_long'),
	decisionMode: z.enum(schema.pollDecisionModes),
	/** Wall-clock time in the poll's timezone. Required in auto mode. */
	deadline: moment.nullable(),
	minAttendees: z.number().int('number').min(1, 'too_small').max(500, 'too_large').nullable(),
	showNames: z.boolean(),
}

export const createPollInput = z.object({
	...settingsFields,
	description: settingsFields.description.default(''),
	location: settingsFields.location.default(''),
	timezone: z.string().refine(isValidTimeZone, 'timezone'),
	locale: z.enum(['en', 'nl']),
	startsOn: date,
	endsOn: date,
	dayStart: halfHour,
	dayEnd: halfHour,
	durationMinutes: z
		.number()
		.int('number')
		.min(cellMinutes, 'too_small')
		.max(1440, 'too_large')
		.refine((m) => m % cellMinutes === 0, 'number'),
	groupId: z.string().nullable().default(null),
})
export type CreatePollInput = z.input<typeof createPollInput>

export const updatePollInput = z.object(settingsFields).partial()
export type UpdatePollInput = z.input<typeof updatePollInput>

const daysBetween = (from: string, to: string) =>
	Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)

/** Auto mode needs a deadline; the minimum can't be checked without one. */
function checkDecision(values: {
	decisionMode: Poll['decisionMode']
	deadlineAt: Date | null
	now: Date
	deadlineChanged: boolean
}) {
	if (values.decisionMode !== 'auto') return
	if (!values.deadlineAt) throw invalid({ deadline: 'required' })
	if (values.deadlineChanged && values.deadlineAt <= values.now)
		throw invalid({ deadline: 'in_past' })
}

export async function createPoll(
	db: Db,
	ctx: OrganizerContext,
	input: CreatePollInput,
	now = new Date(),
): Promise<Poll> {
	requirePermission(ctx, { event: ['create'] })
	const values = parse(createPollInput, input)
	const issues: Record<string, string> = {}
	if (values.endsOn < values.startsOn) issues.endsOn = 'date_order'
	else if (daysBetween(values.startsOn, values.endsOn) >= maxPollDays) issues.endsOn = 'max_days'
	const dayStartMinutes = timeToMinutes(values.dayStart) as number
	const dayEndMinutes = timeToMinutes(values.dayEnd) as number
	if (dayEndMinutes <= dayStartMinutes) issues.dayEnd = 'time_order'
	else if (values.durationMinutes > dayEndMinutes - dayStartMinutes)
		issues.durationMinutes = 'too_large'
	if (Object.keys(issues).length > 0) throw invalid(issues)

	const deadlineAt = values.deadline
		? zonedToUtc(values.deadline.date, values.deadline.time, values.timezone)
		: null
	checkDecision({ decisionMode: values.decisionMode, deadlineAt, now, deadlineChanged: true })
	if (values.groupId) await getPollGroup(db, ctx, values.groupId)

	const { deadline: _, dayStart: __, dayEnd: ___, ...fields } = values
	const [created] = await db
		.insert(schema.poll)
		.values({
			...fields,
			organizationId: ctx.organizationId,
			createdByUserId: ctx.userId,
			shareCode: newAccessToken(),
			dayStartMinutes,
			dayEndMinutes,
			deadlineAt,
		})
		.returning()
	if (!created) throw new Error('Poll insert returned nothing')
	await auditStatement(db, ctx, {
		action: 'poll.create',
		subjectType: 'poll',
		subjectId: created.id,
	})
	return created
}

export async function listPolls(db: Db, ctx: OrganizerContext) {
	return db
		.select({
			id: schema.poll.id,
			title: schema.poll.title,
			status: schema.poll.status,
			startsOn: schema.poll.startsOn,
			endsOn: schema.poll.endsOn,
			timezone: schema.poll.timezone,
			confirmedStartsAt: schema.poll.confirmedStartsAt,
			deadlineAt: schema.poll.deadlineAt,
			responses: count(schema.pollRespondent.id),
		})
		.from(schema.poll)
		.leftJoin(schema.pollRespondent, eq(schema.pollRespondent.pollId, schema.poll.id))
		.where(eq(schema.poll.organizationId, ctx.organizationId))
		.groupBy(schema.poll.id)
		.orderBy(desc(schema.poll.createdAt))
}

/** Throws not_found for polls in other organizations: never reveal they exist. */
export async function getPoll(db: Db, ctx: OrganizerContext, pollId: string): Promise<Poll> {
	const [found] = await db
		.select()
		.from(schema.poll)
		.where(and(eq(schema.poll.id, pollId), eq(schema.poll.organizationId, ctx.organizationId)))
		.limit(1)
	if (!found) throw notFound('Poll')
	return found
}

export type PollRespondentView = {
	id: string
	name: string
	userId: string | null
	availability: Availability
	updatedAt: number
}

/** Everyone who answered, oldest first. Personal data: names only, no emails. */
export async function listRespondents(db: Db, pollId: string): Promise<PollRespondentView[]> {
	const rows = await db
		.select({
			id: schema.pollRespondent.id,
			name: schema.pollRespondent.displayName,
			userId: schema.pollRespondent.userId,
			availability: schema.pollRespondent.availability,
			updatedAt: schema.pollRespondent.updatedAt,
		})
		.from(schema.pollRespondent)
		.where(eq(schema.pollRespondent.pollId, pollId))
		.orderBy(asc(schema.pollRespondent.createdAt))
	return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.getTime() }))
}

/** The poll with its answers, and which group members haven't answered yet. */
export async function getPollOverview(db: Db, ctx: OrganizerContext, pollId: string) {
	const poll = await getPoll(db, ctx, pollId)
	const respondents = await listRespondents(db, pollId)
	let waitingFor: { userId: string; name: string }[] = []
	if (poll.groupId) {
		const answered = new Set(respondents.map((r) => r.userId).filter(Boolean))
		waitingFor = (await groupMembers(db, ctx, poll.groupId))
			.filter((m) => !answered.has(m.userId))
			.map(({ userId, name }) => ({ userId, name }))
	}
	return { poll, respondents, waitingFor }
}

export async function updatePoll(
	db: Db,
	ctx: OrganizerContext,
	pollId: string,
	input: UpdatePollInput,
	now = new Date(),
): Promise<Poll> {
	requirePermission(ctx, { event: ['update'] })
	const values = parse(updatePollInput, input)
	const current = await getPoll(db, ctx, pollId)
	const { deadline, ...fields } = values
	const deadlineAt =
		deadline === undefined
			? current.deadlineAt
			: deadline && zonedToUtc(deadline.date, deadline.time, current.timezone)
	checkDecision({
		decisionMode: values.decisionMode ?? current.decisionMode,
		deadlineAt,
		now,
		deadlineChanged: deadline !== undefined || values.decisionMode === 'auto',
	})

	const [updated] = await db
		.update(schema.poll)
		.set({ ...fields, deadlineAt })
		.where(and(eq(schema.poll.id, pollId), eq(schema.poll.organizationId, ctx.organizationId)))
		.returning()
	if (!updated) throw notFound('Poll')
	await auditStatement(db, ctx, {
		action: 'poll.update',
		subjectType: 'poll',
		subjectId: pollId,
		data: { fields: Object.keys(values) },
	})
	return updated
}

/** A start time the poll offers: on the grid, with the whole evening inside one day. */
function windowAt(poll: Poll, startsAt: number) {
	return rankWindows(poll, []).find((w) => w.startsAt === startsAt) ?? null
}

/** Sets the time. Works while open or waiting for a decision; refuses once confirmed or cancelled. */
export async function confirmPoll(
	db: Db,
	ctx: OrganizerContext,
	pollId: string,
	startsAt: number,
	now = new Date(),
): Promise<Poll> {
	requirePermission(ctx, { event: ['update'] })
	const poll = await getPoll(db, ctx, pollId)
	const window = windowAt(poll, startsAt)
	if (!window) throw invalid({ startsAt: 'outside_event' })
	const [updated] = await db
		.update(schema.poll)
		.set({
			status: 'confirmed',
			confirmedStartsAt: new Date(window.startsAt),
			confirmedEndsAt: new Date(window.endsAt),
			confirmedAt: now,
		})
		.where(
			and(
				eq(schema.poll.id, pollId),
				eq(schema.poll.organizationId, ctx.organizationId),
				inArray(schema.poll.status, ['open', 'needs_decision']),
			),
		)
		.returning()
	if (!updated) throw new DomainError('conflict', 'Poll is not open')
	await auditStatement(db, ctx, {
		action: 'poll.confirm',
		subjectType: 'poll',
		subjectId: pollId,
	})
	return updated
}

/**
 * Opens a poll again for answers. An auto poll whose deadline has passed
 * becomes manual, or the next cron run would close it straight away.
 */
export async function reopenPoll(
	db: Db,
	ctx: OrganizerContext,
	pollId: string,
	now = new Date(),
): Promise<Poll> {
	requirePermission(ctx, { event: ['update'] })
	const poll = await getPoll(db, ctx, pollId)
	const deadlinePassed = poll.deadlineAt !== null && poll.deadlineAt <= now
	const [updated] = await db
		.update(schema.poll)
		.set({
			status: 'open',
			confirmedStartsAt: null,
			confirmedEndsAt: null,
			confirmedAt: null,
			...(poll.decisionMode === 'auto' && deadlinePassed
				? { decisionMode: 'manual' as const }
				: {}),
		})
		.where(and(eq(schema.poll.id, pollId), eq(schema.poll.organizationId, ctx.organizationId)))
		.returning()
	if (!updated) throw notFound('Poll')
	await auditStatement(db, ctx, { action: 'poll.reopen', subjectType: 'poll', subjectId: pollId })
	return updated
}

export async function cancelPoll(db: Db, ctx: OrganizerContext, pollId: string): Promise<Poll> {
	requirePermission(ctx, { event: ['update'] })
	const [updated] = await db
		.update(schema.poll)
		.set({ status: 'cancelled' })
		.where(and(eq(schema.poll.id, pollId), eq(schema.poll.organizationId, ctx.organizationId)))
		.returning()
	if (!updated) throw notFound('Poll')
	await auditStatement(db, ctx, { action: 'poll.cancel', subjectType: 'poll', subjectId: pollId })
	return updated
}

export async function deletePoll(db: Db, ctx: OrganizerContext, pollId: string): Promise<void> {
	requirePermission(ctx, { event: ['delete'] })
	const deleted = await db
		.delete(schema.poll)
		.where(and(eq(schema.poll.id, pollId), eq(schema.poll.organizationId, ctx.organizationId)))
		.returning({ id: schema.poll.id })
	if (deleted.length === 0) throw notFound('Poll')
	await auditStatement(db, ctx, { action: 'poll.delete', subjectType: 'poll', subjectId: pollId })
}

/* ---------- Groups ---------- */

export const pollGroupInput = z.object({
	name: z.string().trim().min(1, 'required').max(80, 'too_long'),
	userIds: z.array(z.string()).max(200, 'too_many'),
})
export type PollGroupInput = z.input<typeof pollGroupInput>

export async function listPollGroups(db: Db, ctx: OrganizerContext) {
	const groups = await db
		.select({ id: schema.pollGroup.id, name: schema.pollGroup.name })
		.from(schema.pollGroup)
		.where(eq(schema.pollGroup.organizationId, ctx.organizationId))
		.orderBy(asc(schema.pollGroup.name))
	if (groups.length === 0) return []
	const members = await db
		.select({ groupId: schema.pollGroupMember.groupId, userId: schema.pollGroupMember.userId })
		.from(schema.pollGroupMember)
		.innerJoin(schema.pollGroup, eq(schema.pollGroup.id, schema.pollGroupMember.groupId))
		.where(eq(schema.pollGroup.organizationId, ctx.organizationId))
	return groups.map((g) => ({
		...g,
		userIds: members.filter((m) => m.groupId === g.id).map((m) => m.userId),
	}))
}

async function getPollGroup(db: Db, ctx: OrganizerContext, groupId: string) {
	const [group] = await db
		.select()
		.from(schema.pollGroup)
		.where(
			and(
				eq(schema.pollGroup.id, groupId),
				eq(schema.pollGroup.organizationId, ctx.organizationId),
			),
		)
		.limit(1)
	if (!group) throw invalid({ groupId: 'not_found' })
	return group
}

/**
 * A group's members who still belong to the organization (someone who left
 * keeps their group row until the group is saved again, but gets no mail).
 */
export async function groupMembers(db: Db, ctx: OrganizerContext, groupId: string) {
	return db
		.select({ userId: schema.user.id, name: schema.user.name, email: schema.user.email })
		.from(schema.pollGroupMember)
		.innerJoin(schema.pollGroup, eq(schema.pollGroup.id, schema.pollGroupMember.groupId))
		.innerJoin(schema.user, eq(schema.user.id, schema.pollGroupMember.userId))
		.innerJoin(
			schema.member,
			and(
				eq(schema.member.userId, schema.user.id),
				eq(schema.member.organizationId, schema.pollGroup.organizationId),
			),
		)
		.where(
			and(
				eq(schema.pollGroup.id, groupId),
				eq(schema.pollGroup.organizationId, ctx.organizationId),
			),
		)
		.orderBy(asc(schema.user.name))
}

/** Creates a group, or replaces an existing one's name and members. Members must belong to the organization. */
export async function savePollGroup(
	db: Db,
	ctx: OrganizerContext,
	groupId: string | null,
	input: PollGroupInput,
): Promise<{ id: string }> {
	requirePermission(ctx, { event: ['update'] })
	const values = parse(pollGroupInput, input)
	const userIds = [...new Set(values.userIds)]
	if (userIds.length > 0) {
		const members = await db
			.select({ userId: schema.member.userId })
			.from(schema.member)
			.where(
				and(
					eq(schema.member.organizationId, ctx.organizationId),
					inArray(schema.member.userId, userIds),
				),
			)
		if (members.length !== userIds.length) throw invalid({ userIds: 'not_found' })
	}

	const id = groupId ?? uuidv7()
	if (groupId) {
		await getPollGroup(db, ctx, groupId)
		await db.batch([
			db.update(schema.pollGroup).set({ name: values.name }).where(eq(schema.pollGroup.id, id)),
			db.delete(schema.pollGroupMember).where(eq(schema.pollGroupMember.groupId, id)),
			...userIds.map((userId) => db.insert(schema.pollGroupMember).values({ groupId: id, userId })),
		])
	} else {
		await db.batch([
			db
				.insert(schema.pollGroup)
				.values({ id, organizationId: ctx.organizationId, name: values.name }),
			...userIds.map((userId) => db.insert(schema.pollGroupMember).values({ groupId: id, userId })),
		])
	}
	await auditStatement(db, ctx, {
		action: groupId ? 'poll.group.update' : 'poll.group.create',
		subjectType: 'poll_group',
		subjectId: id,
		data: { members: userIds.length },
	})
	return { id }
}

export async function deletePollGroup(db: Db, ctx: OrganizerContext, groupId: string) {
	requirePermission(ctx, { event: ['update'] })
	const deleted = await db
		.delete(schema.pollGroup)
		.where(
			and(
				eq(schema.pollGroup.id, groupId),
				eq(schema.pollGroup.organizationId, ctx.organizationId),
			),
		)
		.returning({ id: schema.pollGroup.id })
	if (deleted.length === 0) throw notFound('Group')
	await auditStatement(db, ctx, {
		action: 'poll.group.delete',
		subjectType: 'poll_group',
		subjectId: groupId,
	})
}

/* ---------- Respondents ---------- */

export async function pollByShareCode(db: Db, code: string): Promise<Poll | null> {
	if (!/^[\w-]{10,64}$/.test(code)) return null
	const [found] = await db
		.select()
		.from(schema.poll)
		.where(eq(schema.poll.shareCode, code))
		.limit(1)
	return found ?? null
}

export const editTokenHash = (token: string) => sha256(`poll-edit:${token}`)

export async function respondentFromToken(db: Db, token: string) {
	if (!/^[\w-]{10,64}$/.test(token)) return null
	const [found] = await db
		.select({ id: schema.pollRespondent.id, pollId: schema.pollRespondent.pollId })
		.from(schema.pollRespondent)
		.where(eq(schema.pollRespondent.editTokenHash, await editTokenHash(token)))
		.limit(1)
	return found ?? null
}

/** What a guest's cookie is signed over: rotating the token would log out old cookies. */
export async function respondentStamp(db: Db, respondentId: string): Promise<string | null> {
	const [found] = await db
		.select({ hash: schema.pollRespondent.editTokenHash })
		.from(schema.pollRespondent)
		.where(eq(schema.pollRespondent.id, respondentId))
		.limit(1)
	return found?.hash ?? null
}

export async function findRespondent(
	db: Db,
	pollId: string,
	who: { userId: string } | { respondentId: string },
) {
	const [found] = await db
		.select({
			id: schema.pollRespondent.id,
			name: schema.pollRespondent.displayName,
			email: schema.pollRespondent.email,
			userId: schema.pollRespondent.userId,
		})
		.from(schema.pollRespondent)
		.where(
			and(
				eq(schema.pollRespondent.pollId, pollId),
				'userId' in who
					? eq(schema.pollRespondent.userId, who.userId)
					: eq(schema.pollRespondent.id, who.respondentId),
			),
		)
		.limit(1)
	return found ?? null
}

export const responseInput = z.object({
	name: z.string().trim().min(1, 'required').max(80, 'too_long'),
	email: z.email('email').max(254, 'too_long').nullable().default(null),
	availability: z.object({
		free: z.array(z.number().int()).max(2000, 'too_many'),
		ifNeeded: z.array(z.number().int()).max(2000, 'too_many'),
	}),
})
export type ResponseInput = z.input<typeof responseInput>

export type Responder =
	/** Signed in: one answer per account, and their account email gets the result. */
	| { kind: 'user'; userId: string }
	/** A guest coming back with their cookie or edit link. */
	| { kind: 'respondent'; respondentId: string }
	| { kind: 'guest' }

export type SavedResponse = { respondentId: string; editToken: string | null }

/** Saves someone's availability. Only while the poll is open. */
export async function saveResponse(
	db: Db,
	poll: Poll,
	who: Responder,
	input: ResponseInput,
): Promise<SavedResponse> {
	if (poll.status !== 'open') throw new DomainError('conflict', 'Poll is not open')
	const values = parse(responseInput, input)
	const availability = cleanAvailability(poll, values.availability)
	const fields = { displayName: values.name, availability }

	if (who.kind === 'user') {
		const [saved] = await db
			.insert(schema.pollRespondent)
			.values({
				...fields,
				organizationId: poll.organizationId,
				pollId: poll.id,
				userId: who.userId,
			})
			.onConflictDoUpdate({
				target: [schema.pollRespondent.pollId, schema.pollRespondent.userId],
				set: { ...fields, updatedAt: new Date() },
			})
			.returning({ id: schema.pollRespondent.id })
		if (!saved) throw new Error('Respondent upsert returned nothing')
		return { respondentId: saved.id, editToken: null }
	}

	if (who.kind === 'respondent') {
		const [saved] = await db
			.update(schema.pollRespondent)
			.set({ ...fields, email: values.email })
			.where(
				and(
					eq(schema.pollRespondent.id, who.respondentId),
					eq(schema.pollRespondent.pollId, poll.id),
				),
			)
			.returning({ id: schema.pollRespondent.id })
		if (!saved) throw notFound('Response')
		return { respondentId: saved.id, editToken: null }
	}

	const editToken = newAccessToken()
	const [created] = await db
		.insert(schema.pollRespondent)
		.values({
			...fields,
			email: values.email,
			organizationId: poll.organizationId,
			pollId: poll.id,
			editTokenHash: await editTokenHash(editToken),
		})
		.returning({ id: schema.pollRespondent.id })
	if (!created) throw new Error('Respondent insert returned nothing')
	return { respondentId: created.id, editToken }
}

/** Removes someone's answer (they changed their mind about joining). */
export async function deleteResponse(db: Db, poll: Poll, respondentId: string): Promise<void> {
	if (poll.status !== 'open') throw new DomainError('conflict', 'Poll is not open')
	await db
		.delete(schema.pollRespondent)
		.where(
			and(eq(schema.pollRespondent.id, respondentId), eq(schema.pollRespondent.pollId, poll.id)),
		)
}

/* ---------- Deciding automatically ---------- */

export type Resolution =
	| { pollId: string; outcome: 'confirmed'; startsAt: number; endsAt: number }
	| { pollId: string; outcome: 'needs_decision' }

/**
 * At an auto poll's deadline: confirms the best time if enough people can
 * come (at least `minAttendees`, and always at least one), otherwise asks the
 * organizer to decide. Guarded on status, so concurrent callers (the cron and
 * a page load) resolve a poll once; the loser gets null.
 */
export async function resolvePoll(
	db: Db,
	poll: Poll,
	now = new Date(),
): Promise<Resolution | null> {
	if (poll.status !== 'open' || poll.decisionMode !== 'auto') return null
	if (!poll.deadlineAt || poll.deadlineAt > now) return null

	const respondents = await listRespondents(db, poll.id)
	const [best] = rankWindows(
		poll,
		respondents.map((r) => ({ id: r.id, name: r.name, availability: r.availability })),
	)
	const needed = Math.max(1, poll.minAttendees ?? 1)
	const enough = best && attendance(best) >= needed

	const guard = and(
		eq(schema.poll.id, poll.id),
		eq(schema.poll.status, 'open'),
		eq(schema.poll.decisionMode, 'auto'),
	)
	const [updated] = await db
		.update(schema.poll)
		.set(
			enough
				? {
						status: 'confirmed',
						confirmedStartsAt: new Date(best.startsAt),
						confirmedEndsAt: new Date(best.endsAt),
						confirmedAt: now,
					}
				: { status: 'needs_decision' },
		)
		.where(guard)
		.returning({ id: schema.poll.id })
	if (!updated) return null

	await db.insert(schema.auditLog).values({
		organizationId: poll.organizationId,
		actorKind: 'system',
		action: enough ? 'poll.confirm.auto' : 'poll.needs_decision',
		subjectType: 'poll',
		subjectId: poll.id,
	})
	return enough
		? { pollId: poll.id, outcome: 'confirmed', startsAt: best.startsAt, endsAt: best.endsAt }
		: { pollId: poll.id, outcome: 'needs_decision' }
}

/** Every auto poll past its deadline. Run by the jobs cron. */
export async function resolveDuePolls(db: Db, now = new Date()): Promise<Resolution[]> {
	const due = await db
		.select()
		.from(schema.poll)
		.where(
			and(
				eq(schema.poll.status, 'open'),
				eq(schema.poll.decisionMode, 'auto'),
				isNotNull(schema.poll.deadlineAt),
				lte(schema.poll.deadlineAt, now),
			),
		)
	const resolved: Resolution[] = []
	for (const poll of due) {
		const result = await resolvePoll(db, poll, now)
		if (result) resolved.push(result)
	}
	return resolved
}

/* ---------- Who to tell ---------- */

/**
 * Everyone with an address who should hear the outcome: respondents (their
 * account email when signed in, else the one they left) and the organizer
 * who created the poll. One entry per address.
 */
export async function pollRecipients(db: Db, pollId: string) {
	const rows = await db
		.select({
			id: schema.pollRespondent.id,
			name: schema.pollRespondent.displayName,
			email: sql<string | null>`coalesce(${schema.user.email}, ${schema.pollRespondent.email})`,
		})
		.from(schema.pollRespondent)
		.leftJoin(schema.user, eq(schema.user.id, schema.pollRespondent.userId))
		.where(eq(schema.pollRespondent.pollId, pollId))
	const [creator] = await db
		.select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
		.from(schema.poll)
		.innerJoin(schema.user, eq(schema.user.id, schema.poll.createdByUserId))
		.where(eq(schema.poll.id, pollId))
		.limit(1)
	const byEmail = new Map<string, { key: string; name: string; email: string }>()
	for (const r of rows) {
		if (r.email) byEmail.set(r.email.toLowerCase(), { key: r.id, name: r.name, email: r.email })
	}
	if (creator && !byEmail.has(creator.email.toLowerCase())) {
		byEmail.set(creator.email.toLowerCase(), {
			key: `user-${creator.id}`,
			name: creator.name,
			email: creator.email,
		})
	}
	return { recipients: [...byEmail.values()], creator: creator ?? null }
}

/**
 * The emails for a poll's outcome, each claimed once (so a cron retry or a
 * second confirm click never mails twice). Confirmed: everyone with an
 * address. Needs a decision: the organizer who created it.
 */
export async function pollOutcomeEmails(
	db: Db,
	poll: Poll,
	app: { url: string; name: string },
): Promise<PollEmail[]> {
	const link = `${app.url}/m/${poll.shareCode}`
	const { recipients, creator } = await pollRecipients(db, poll.id)
	let drafts: { key: string; email: PollEmail }[] = []

	if (poll.status === 'confirmed' && poll.confirmedStartsAt && poll.confirmedEndsAt) {
		const startsAt = poll.confirmedStartsAt.getTime()
		const when = formatPollWindow(
			startsAt,
			poll.confirmedEndsAt.getTime(),
			poll.timezone,
			poll.locale,
		)
		drafts = recipients.map((r) => ({
			// A new time after reopening is news again: the key includes it.
			key: `poll-confirmed:${poll.id}:${startsAt}:${r.key}`,
			email: pollConfirmedEmail({
				to: r.email,
				locale: poll.locale,
				appName: app.name,
				title: poll.title,
				when,
				location: poll.location,
				link,
			}),
		}))
	} else if (poll.status === 'needs_decision' && creator) {
		drafts = [
			{
				key: `poll-needs-decision:${poll.id}:${poll.deadlineAt?.getTime() ?? 0}`,
				email: pollNeedsDecisionEmail({
					to: creator.email,
					locale: poll.locale,
					appName: app.name,
					title: poll.title,
					link: `${app.url}/polls/${poll.id}`,
				}),
			},
		]
	}

	const claimed = await claimEmails(
		db,
		drafts.map((d) => ({
			organizationId: poll.organizationId,
			eventId: null,
			registrationId: null,
			kind: d.key.split(':')[0] as string,
			key: d.key,
		})),
	)
	return drafts.filter((d) => claimed.has(d.key)).map((d) => d.email)
}

/** A poll by id, without organizer scoping: for the jobs Worker after an automatic decision. */
export async function pollById(db: Db, pollId: string): Promise<Poll | null> {
	const [found] = await db.select().from(schema.poll).where(eq(schema.poll.id, pollId)).limit(1)
	return found ?? null
}

/* ---------- Retention ---------- */

/** Days a poll's names and answers are kept after its last day (docs/availability-polls.md). */
export const pollRetentionDays = 90

/** Deletes polls whose grid ended more than 90 days ago, answers and all. */
export async function deleteExpiredPolls(db: Db, now = new Date()): Promise<number> {
	const today = now.toISOString().slice(0, 10)
	const deleted = await db
		.delete(schema.poll)
		.where(sql`date(${schema.poll.endsOn}, ${`+${pollRetentionDays} days`}) <= ${today}`)
		.returning({ id: schema.poll.id })
	return deleted.length
}
