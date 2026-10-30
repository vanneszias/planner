import { describe, expect, it } from 'vitest'
import { type AllocationInput, allocate, inputHash, type Session } from '../src/index.ts'

const hour = 3_600_000
const at = (h: number) => Date.UTC(2027, 6, 12, h)
const session = (
	id: string,
	workshopId: string,
	startHour: number,
	capacity: number,
	extra: Partial<Session> = {},
): Session => ({
	id,
	workshopId,
	startsAt: at(startHour),
	endsAt: at(startHour) + hour,
	capacity,
	...extra,
})

const rules = {
	sessionsPerParticipant: 1,
	strategy: 'take-turns' as const,
	seed: 'seed-1',
	fillUnassigned: 'none' as const,
}

const sessionsOf = (result: ReturnType<typeof allocate>, participantId: string) =>
	result.assignments.filter((a) => a.participantId === participantId).map((a) => a.sessionId)

describe('take turns', () => {
	it('gives a contested single seat to exactly one person and explains it to the other', () => {
		const result = allocate({
			participants: [{ id: 'ana' }, { id: 'bo' }],
			sessions: [session('climb', 'climbing', 10, 1), session('print', 'printing', 10, 5)],
			preferences: { ana: ['climbing', 'printing'], bo: ['climbing', 'printing'] },
			rules,
		})
		const winners = result.assignments.filter((a) => a.sessionId === 'climb')
		expect(winners).toHaveLength(1)
		const loser = winners[0]?.participantId === 'ana' ? 'bo' : 'ana'
		expect(sessionsOf(result, loser)).toEqual(['print'])
		expect(result.traces[loser]).toEqual([
			{ round: 0, kind: 'skipped', workshopId: 'climbing', rank: 1, reason: 'full' },
			{ round: 0, kind: 'assigned', workshopId: 'printing', rank: 2, sessionId: 'print' },
		])
		expect(result.metrics.firstChoiceShare).toBe(0.5)
	})

	it('reverses the order every round (snake)', () => {
		// Two people, two rounds, two popular single-seat workshops at different times.
		const input: AllocationInput = {
			participants: [{ id: 'ana' }, { id: 'bo' }],
			sessions: [
				session('a1', 'archery', 10, 1),
				session('b1', 'baking', 12, 1),
				session('c1', 'chess', 14, 2),
			],
			preferences: { ana: ['archery', 'baking', 'chess'], bo: ['archery', 'baking', 'chess'] },
			rules: { ...rules, sessionsPerParticipant: 2 },
		}
		const result = allocate(input)
		const first = result.assignments.find(
			(a) => a.round === 0 && a.sessionId === 'a1',
		)?.participantId
		const second = first === 'ana' ? 'bo' : 'ana'
		// Round 1 is reversed: the one who lost archery picks first and gets baking.
		expect(sessionsOf(result, second)).toContain('b1')
		expect(sessionsOf(result, first as string)).toEqual(['a1', 'c1'])
	})

	it('gives the same result for the same seed, whatever the input order', () => {
		const participants = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}` }))
		const sessions = [
			session('s1', 'w1', 10, 5),
			session('s2', 'w2', 10, 5),
			session('s3', 'w3', 11, 30),
		]
		const preferences = Object.fromEntries(participants.map((p) => [p.id, ['w1', 'w2', 'w3']]))
		const a = allocate({ participants, sessions, preferences, rules })
		const b = allocate({
			participants: [...participants].reverse(),
			sessions: [...sessions].reverse(),
			preferences,
			rules,
		})
		expect(b.assignments).toEqual(a.assignments)
		const c = allocate({ participants, sessions, preferences, rules: { ...rules, seed: 'other' } })
		expect(c.assignments).not.toEqual(a.assignments)
	})
})

describe('early birds first', () => {
	it('lets earlier submitters choose first', () => {
		const result = allocate({
			participants: [
				{ id: 'late', submittedAt: 3000 },
				{ id: 'early', submittedAt: 1000 },
				{ id: 'never', submittedAt: null },
			],
			sessions: [session('s', 'w', 10, 1), session('t', 'x', 10, 5)],
			preferences: { late: ['w', 'x'], early: ['w', 'x'], never: ['w', 'x'] },
			rules: { ...rules, strategy: 'early-birds' },
		})
		expect(sessionsOf(result, 'early')).toEqual(['s'])
		expect(sessionsOf(result, 'late')).toEqual(['t'])
	})
})

describe('session choice', () => {
	it('picks the session that keeps other choices possible', () => {
		// Painting runs at 10 and 12; dance only at 10. Taking painting at 12 keeps dance open.
		const result = allocate({
			participants: [{ id: 'ana' }],
			sessions: [
				session('paint10', 'painting', 10, 5),
				session('paint12', 'painting', 12, 5),
				session('dance10', 'dance', 10, 5),
			],
			preferences: { ana: ['painting', 'dance'] },
			rules: { ...rules, sessionsPerParticipant: 2 },
		})
		expect(sessionsOf(result, 'ana')).toEqual(['paint12', 'dance10'])
	})

	it('never gives two sessions of the same workshop or overlapping sessions', () => {
		const result = allocate({
			participants: [{ id: 'ana' }],
			sessions: [session('a', 'w1', 10, 5), session('b', 'w1', 12, 5), session('c', 'w2', 10, 5)],
			preferences: { ana: ['w1', 'w2'] },
			rules: { ...rules, sessionsPerParticipant: 3 },
		})
		expect(sessionsOf(result, 'ana')).toHaveLength(2)
		expect(result.unfilled).toEqual([
			{ participantId: 'ana', slots: 1, reason: 'preferences_exhausted' },
		])
	})
})

describe('eligibility, locks and filling', () => {
	it('respects age groups and says why', () => {
		const result = allocate({
			participants: [{ id: 'kid', ageGroupId: 'young' }],
			sessions: [
				session('teen', 'podcast', 10, 5, { ageGroupIds: ['older'] }),
				session('open', 'games', 10, 5),
			],
			preferences: { kid: ['podcast', 'games'] },
			rules,
		})
		expect(sessionsOf(result, 'kid')).toEqual(['open'])
		expect(result.traces.kid?.[0]).toMatchObject({ kind: 'skipped', reason: 'not_eligible' })
	})

	it('keeps locked placements, counts them against capacity and around them', () => {
		const result = allocate({
			participants: [{ id: 'helper' }, { id: 'ana' }],
			sessions: [session('s', 'w', 10, 1), session('t', 'x', 10, 5)],
			preferences: { helper: ['x'], ana: ['w', 'x'] },
			locked: [{ participantId: 'helper', sessionId: 's' }],
			rules,
		})
		expect(result.assignments).toContainEqual(
			expect.objectContaining({ participantId: 'helper', sessionId: 's', source: 'locked' }),
		)
		// helper already has their one slot; ana can't get the full session.
		expect(sessionsOf(result, 'helper')).toEqual(['s'])
		expect(sessionsOf(result, 'ana')).toEqual(['t'])
	})

	it('warns when locked placements exceed capacity', () => {
		const result = allocate({
			participants: [{ id: 'a' }, { id: 'b' }],
			sessions: [session('s', 'w', 10, 1)],
			preferences: {},
			locked: [
				{ participantId: 'a', sessionId: 's' },
				{ participantId: 'b', sessionId: 's' },
			],
			rules,
		})
		expect(result.warnings).toEqual([{ kind: 'locked_over_capacity', sessionId: 's' }])
	})

	it('fills empty slots with open sessions only when asked (D10)', () => {
		const input: AllocationInput = {
			participants: [{ id: 'ana' }],
			sessions: [session('full', 'w', 10, 0), session('spare', 'x', 10, 5)],
			preferences: { ana: ['w'] },
			rules,
		}
		expect(sessionsOf(allocate(input), 'ana')).toEqual([])
		const filled = allocate({ ...input, rules: { ...rules, fillUnassigned: 'any-open' } })
		expect(filled.assignments).toEqual([
			expect.objectContaining({
				participantId: 'ana',
				sessionId: 'spare',
				source: 'filled',
				rank: null,
			}),
		])
		expect(filled.metrics.filled).toBe(1)
	})
})

describe('metrics and hash', () => {
	it('reports rank counts and the worst-off participant', () => {
		const result = allocate({
			participants: [{ id: 'ana' }, { id: 'bo' }],
			sessions: [session('s', 'w', 10, 1)],
			preferences: { ana: ['w'], bo: ['w'] },
			rules,
		})
		expect(result.metrics).toMatchObject({
			participants: 2,
			slotsRequested: 2,
			slotsFilled: 1,
			unfilledSlots: 1,
			rankCounts: [1],
			averageRank: 1,
		})
		expect(result.metrics.worstOff?.unfilled).toBe(1)
	})

	it('hashes inputs independently of array order', async () => {
		const input: AllocationInput = {
			participants: [{ id: 'a' }, { id: 'b' }],
			sessions: [session('s', 'w', 10, 1), session('t', 'x', 10, 1)],
			preferences: { a: ['w'], b: ['x'] },
			rules,
		}
		const same = await inputHash({ ...input, participants: [...input.participants].reverse() })
		expect(same).toBe(await inputHash(input))
		expect(await inputHash({ ...input, rules: { ...rules, seed: 'x' } })).not.toBe(same)
	})
})
