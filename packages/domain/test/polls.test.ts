import { schema } from '@app/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
	type CreatePollInput,
	cancelPoll,
	cleanAvailability,
	confirmPoll,
	createPoll,
	DomainError,
	deleteExpiredPolls,
	getPoll,
	groupMembers,
	listRespondents,
	pollByShareCode,
	pollCalendarFile,
	pollCells,
	pollOutcomeEmails,
	rankWindows,
	reopenPoll,
	resolveDuePolls,
	resolvePoll,
	respondentFromToken,
	savePollGroup,
	saveResponse,
} from '../src/index.ts'
import { addMember, db, seedOrganization } from './fixtures.ts'

const now = new Date('2026-11-04T12:00:00Z')

/** Three evenings, 19:00–22:00 Brussels, two-hour meetings: 6 cells and 3 start times a day. */
const prayerEvening = {
	title: 'Prayer evening',
	location: "Anna's place",
	timezone: 'Europe/Brussels',
	locale: 'en',
	startsOn: '2026-11-10',
	endsOn: '2026-11-12',
	dayStart: '19:00',
	dayEnd: '22:00',
	durationMinutes: 120,
	decisionMode: 'manual',
	deadline: null,
	minAttendees: null,
	showNames: true,
} satisfies CreatePollInput

/** The cell instants for a date and its wall-clock times. */
function cellsAt(poll: Parameters<typeof pollCells>[0], date: string, ...times: number[]) {
	return pollCells(poll)
		.filter((c) => c.date === date && times.includes(c.minutes))
		.map((c) => c.startsAt)
}

async function expectCode(promise: Promise<unknown>, code: string) {
	const error = await promise.then(
		() => null,
		(e: unknown) => e,
	)
	expect(error).toBeInstanceOf(DomainError)
	expect((error as DomainError).code).toBe(code)
	return error as DomainError
}

describe('poll grid', () => {
	it('lays out 30-minute cells in the poll timezone, across a DST change', () => {
		const shape = { ...prayerEvening, dayStartMinutes: 19 * 60, dayEndMinutes: 22 * 60 }
		const cells = pollCells(shape)
		expect(cells).toHaveLength(18)
		expect(new Date(cells[0]?.startsAt as number).toISOString()).toBe('2026-11-10T18:00:00.000Z')

		const dst = pollCells({ ...shape, startsOn: '2026-03-28', endsOn: '2026-03-29' })
		expect(new Date(dst[0]?.startsAt as number).toISOString()).toBe('2026-03-28T18:00:00.000Z')
		expect(new Date(dst[6]?.startsAt as number).toISOString()).toBe('2026-03-29T17:00:00.000Z')
	})

	it('ranks by who can come, then who is truly free, then earliest', () => {
		const shape = { ...prayerEvening, dayStartMinutes: 19 * 60, dayEndMinutes: 22 * 60 }
		const thu = (...t: number[]) => cellsAt(shape, '2026-11-12', ...t)
		const tue = (...t: number[]) => cellsAt(shape, '2026-11-10', ...t)
		const windows = rankWindows(shape, [
			{
				id: 'a',
				name: 'A',
				availability: {
					free: [...tue(1140, 1170, 1200, 1230), ...thu(1200, 1230, 1260, 1290)],
					ifNeeded: [],
				},
			},
			{
				id: 'b',
				name: 'B',
				availability: {
					free: tue(1140, 1170, 1200),
					ifNeeded: [...tue(1230), ...thu(1200, 1230, 1260, 1290)],
				},
			},
			{ id: 'c', name: 'C', availability: { free: thu(1200, 1230, 1260, 1290), ifNeeded: [] } },
		])
		// 9 start times; a two-hour evening can't start after 20:00.
		expect(windows).toHaveLength(9)
		expect(windows.every((w) => w.minutes <= 20 * 60)).toBe(true)
		// Thursday 20:00 fits all three (one "if needed"); Tuesday 19:00 only two.
		expect(windows[0]).toMatchObject({
			date: '2026-11-12',
			minutes: 1200,
			free: ['a', 'c'],
			ifNeeded: ['b'],
		})
		expect(windows[1]).toMatchObject({
			date: '2026-11-10',
			minutes: 1140,
			free: ['a'],
			ifNeeded: ['b'],
		})
	})

	it('drops marks that are off the grid and lets free win over if needed', () => {
		const shape = { ...prayerEvening, dayStartMinutes: 19 * 60, dayEndMinutes: 22 * 60 }
		const [first, second] = cellsAt(shape, '2026-11-10', 1140, 1170) as [number, number]
		expect(
			cleanAvailability(shape, { free: [second, first, first, 123], ifNeeded: [first, 456] }),
		).toEqual({ free: [first, second], ifNeeded: [] })
	})

	it('writes a calendar file with escaped text and folded lines', () => {
		const ics = pollCalendarFile({
			uid: 'p1@test',
			title:
				'Prayer, praise; and a very long title that goes well past the seventy five octet limit',
			description: 'Bring\na snack',
			location: '',
			startsAt: Date.UTC(2026, 10, 12, 19),
			endsAt: Date.UTC(2026, 10, 12, 21),
			now: Date.UTC(2026, 10, 4),
		})
		expect(ics).toContain('DTSTART:20261112T190000Z\r\n')
		expect(ics).toContain('SUMMARY:Prayer\\, praise\\; and')
		expect(ics).toContain('DESCRIPTION:Bring\\na snack')
		expect(ics).not.toContain('LOCATION')
		expect(ics.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75)).toBe(
			true,
		)
	})
})

describe('polls', () => {
	it('validates the grid and the decision settings', async () => {
		const ctx = await seedOrganization()
		const error = await expectCode(
			createPoll(db, ctx, { ...prayerEvening, dayEnd: '20:00', dayStart: '19:15' }, now),
			'invalid',
		)
		expect(error.issues).toMatchObject({ dayStart: 'time' })
		const tooLong = await expectCode(
			createPoll(db, ctx, { ...prayerEvening, dayEnd: '20:30' }, now),
			'invalid',
		)
		expect(tooLong.issues).toEqual({ durationMinutes: 'too_large' })
		const auto = await expectCode(
			createPoll(db, ctx, { ...prayerEvening, decisionMode: 'auto' }, now),
			'invalid',
		)
		expect(auto.issues).toEqual({ deadline: 'required' })
		const past = await expectCode(
			createPoll(
				db,
				ctx,
				{ ...prayerEvening, decisionMode: 'auto', deadline: { date: '2026-11-01', time: '12:00' } },
				now,
			),
			'invalid',
		)
		expect(past.issues).toEqual({ deadline: 'in_past' })
		const month = await expectCode(
			createPoll(db, ctx, { ...prayerEvening, endsOn: '2026-12-20' }, now),
			'invalid',
		)
		expect(month.issues).toEqual({ endsOn: 'max_days' })
	})

	it('keeps polls inside their organization and out of viewers hands', async () => {
		const ctx = await seedOrganization()
		const other = await seedOrganization()
		const poll = await createPoll(db, ctx, prayerEvening, now)
		await expectCode(getPoll(db, other, poll.id), 'not_found')
		await expectCode(confirmPoll(db, other, poll.id, poll.createdAt.getTime()), 'not_found')
		const viewer = await addMember(ctx.organizationId, 'viewer')
		await expectCode(createPoll(db, viewer, prayerEvening, now), 'forbidden')
	})

	it('takes answers from guests and signed-in people, and edits them in place', async () => {
		const ctx = await seedOrganization()
		const poll = await createPoll(db, ctx, prayerEvening, now)
		expect((await pollByShareCode(db, poll.shareCode))?.id).toBe(poll.id)
		const [cell] = cellsAt(poll, '2026-11-10', 1140) as [number]

		const guest = await saveResponse(
			db,
			poll,
			{ kind: 'guest' },
			{
				name: 'Joris',
				email: 'joris@example.com',
				availability: { free: [cell], ifNeeded: [] },
			},
		)
		expect(guest.editToken).toBeTruthy()
		expect(await respondentFromToken(db, guest.editToken as string)).toEqual({
			id: guest.respondentId,
			pollId: poll.id,
		})
		await saveResponse(
			db,
			poll,
			{ kind: 'respondent', respondentId: guest.respondentId },
			{
				name: 'Joris V',
				email: null,
				availability: { free: [], ifNeeded: [cell] },
			},
		)

		const first = await saveResponse(
			db,
			poll,
			{ kind: 'user', userId: ctx.userId },
			{
				name: 'Zias',
				availability: { free: [cell], ifNeeded: [] },
			},
		)
		const again = await saveResponse(
			db,
			poll,
			{ kind: 'user', userId: ctx.userId },
			{
				name: 'Zias',
				availability: { free: [], ifNeeded: [] },
			},
		)
		expect(again.respondentId).toBe(first.respondentId)

		const respondents = await listRespondents(db, poll.id)
		expect(respondents.map((r) => [r.name, r.availability])).toEqual([
			['Joris V', { free: [], ifNeeded: [cell] }],
			['Zias', { free: [], ifNeeded: [] }],
		])

		await cancelPoll(db, ctx, poll.id)
		const closed = await getPoll(db, ctx, poll.id)
		await expectCode(
			saveResponse(
				db,
				closed,
				{ kind: 'guest' },
				{ name: 'Late', availability: { free: [], ifNeeded: [] } },
			),
			'conflict',
		)
	})

	it('confirms only real start times, once, and reopens', async () => {
		const ctx = await seedOrganization()
		const poll = await createPoll(db, ctx, prayerEvening, now)
		const [at2030] = cellsAt(poll, '2026-11-10', 1230) as [number]
		const [at1930] = cellsAt(poll, '2026-11-10', 1170) as [number]
		// 20:30 + two hours runs past 22:00.
		await expectCode(confirmPoll(db, ctx, poll.id, at2030, now), 'invalid')
		const confirmed = await confirmPoll(db, ctx, poll.id, at1930, now)
		expect(confirmed.confirmedEndsAt?.getTime()).toBe(at1930 + 2 * 3600_000)
		await expectCode(confirmPoll(db, ctx, poll.id, at1930, now), 'conflict')
		const reopened = await reopenPoll(db, ctx, poll.id, now)
		expect(reopened).toMatchObject({ status: 'open', confirmedStartsAt: null })
	})
})

describe('automatic decisions', () => {
	const auto = (minAttendees: number | null) =>
		({
			...prayerEvening,
			decisionMode: 'auto',
			deadline: { date: '2026-11-08', time: '20:00' },
			minAttendees,
		}) satisfies CreatePollInput
	const afterDeadline = new Date('2026-11-08T20:00:00Z')

	it('confirms the best time at the deadline when enough people can come, once', async () => {
		const ctx = await seedOrganization()
		const poll = await createPoll(db, ctx, auto(2), now)
		const wed = cellsAt(poll, '2026-11-11', 1140, 1170, 1200, 1230)
		for (const name of ['Anna', 'Joris']) {
			await saveResponse(
				db,
				poll,
				{ kind: 'guest' },
				{
					name,
					email: `${name}@example.com`,
					availability: { free: wed, ifNeeded: [] },
				},
			)
		}
		expect(await resolvePoll(db, poll, now)).toBeNull() // before the deadline

		const [resolution] = await resolveDuePolls(db, afterDeadline)
		expect(resolution).toMatchObject({ pollId: poll.id, outcome: 'confirmed', startsAt: wed[0] })
		expect(await resolvePoll(db, poll, afterDeadline)).toBeNull() // already resolved

		const confirmed = await getPoll(db, ctx, poll.id)
		const emails = await pollOutcomeEmails(db, confirmed, {
			url: 'https://app.test',
			name: 'Planner',
		})
		expect(emails.map((e) => e.to).sort()).toEqual(
			['Anna@example.com', 'Joris@example.com', `${ctx.userId}@example.com`].sort(),
		)
		expect(emails[0]?.text).toContain(`https://app.test/m/${poll.shareCode}`)
		// Claimed: a retry sends nothing.
		expect(
			await pollOutcomeEmails(db, confirmed, { url: 'https://app.test', name: 'Planner' }),
		).toEqual([])
	})

	it('asks the organizer when no time reaches the minimum', async () => {
		const ctx = await seedOrganization()
		const poll = await createPoll(db, ctx, auto(3), now)
		await saveResponse(
			db,
			poll,
			{ kind: 'guest' },
			{
				name: 'Anna',
				availability: { free: cellsAt(poll, '2026-11-11', 1140, 1170, 1200, 1230), ifNeeded: [] },
			},
		)
		expect(await resolvePoll(db, poll, afterDeadline)).toEqual({
			pollId: poll.id,
			outcome: 'needs_decision',
		})
		const waiting = await getPoll(db, ctx, poll.id)
		const emails = await pollOutcomeEmails(db, waiting, {
			url: 'https://app.test',
			name: 'Planner',
		})
		expect(emails).toHaveLength(1)
		expect(emails[0]).toMatchObject({ to: `${ctx.userId}@example.com` })
		expect(emails[0]?.text).toContain(`https://app.test/polls/${poll.id}`)

		// Reopening after the deadline turns it manual, so the cron leaves it alone.
		expect((await reopenPoll(db, ctx, poll.id, afterDeadline)).decisionMode).toBe('manual')
	})
})

describe('groups and retention', () => {
	it('only takes organization members, and drops people who left', async () => {
		const ctx = await seedOrganization()
		const friend = await addMember(ctx.organizationId, 'viewer')
		const stranger = await seedOrganization()
		await expectCode(
			savePollGroup(db, ctx, null, { name: 'Prayer group', userIds: [stranger.userId] }),
			'invalid',
		)
		const { id } = await savePollGroup(db, ctx, null, {
			name: 'Prayer group',
			userIds: [ctx.userId, friend.userId],
		})
		expect((await groupMembers(db, ctx, id)).map((m) => m.userId).sort()).toEqual(
			[ctx.userId, friend.userId].sort(),
		)
		await db.delete(schema.member).where(eq(schema.member.userId, friend.userId))
		expect((await groupMembers(db, ctx, id)).map((m) => m.userId)).toEqual([ctx.userId])
		expect(await groupMembers(db, stranger, id)).toEqual([])
	})

	it('deletes polls 90 days after their last day', async () => {
		const ctx = await seedOrganization()
		const poll = await createPoll(db, ctx, prayerEvening, now)
		expect(await deleteExpiredPolls(db, new Date('2027-02-09T12:00:00Z'))).toBe(0)
		await deleteExpiredPolls(db, new Date('2027-02-10T12:00:00Z'))
		await expectCode(getPoll(db, ctx, poll.id), 'not_found')
	})
})
