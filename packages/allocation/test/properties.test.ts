import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type AllocationInput, allocate } from '../src/index.ts'

/*
 * Property tests: for random events, the hard constraints in
 * docs/allocation-mvp.md must always hold.
 */

const hour = 3_600_000
const ageGroups = ['young', 'older']

const event = fc
	.record({
		participantCount: fc.integer({ min: 1, max: 40 }),
		workshopCount: fc.integer({ min: 1, max: 8 }),
		sessionsPerParticipant: fc.integer({ min: 1, max: 4 }),
		seed: fc.string({ minLength: 1, maxLength: 8 }),
		strategy: fc.constantFrom('take-turns' as const, 'early-birds' as const),
		fillUnassigned: fc.constantFrom('none' as const, 'any-open' as const),
	})
	.chain((shape) =>
		fc.record({
			shape: fc.constant(shape),
			// Sessions: workshop index, start hour 9–16, length 1–2 h, capacity 0–6, optional age limit.
			sessions: fc.array(
				fc.record({
					workshop: fc.integer({ min: 0, max: shape.workshopCount - 1 }),
					start: fc.integer({ min: 9, max: 16 }),
					length: fc.integer({ min: 1, max: 2 }),
					capacity: fc.integer({ min: 0, max: 6 }),
					ageGroup: fc.option(fc.constantFrom(...ageGroups), { nil: undefined }),
				}),
				{ minLength: 1, maxLength: 20 },
			),
			participants: fc.array(
				fc.record({
					ageGroup: fc.option(fc.constantFrom(...ageGroups), { nil: null }),
					submittedAt: fc.option(fc.integer({ min: 0, max: 1000 }), { nil: null }),
					ranking: fc.uniqueArray(fc.integer({ min: 0, max: shape.workshopCount - 1 }), {
						maxLength: 6,
					}),
				}),
				{ minLength: shape.participantCount, maxLength: shape.participantCount },
			),
			lockFirst: fc.boolean(),
		}),
	)
	.map(({ shape, sessions, participants, lockFirst }): AllocationInput => {
		const sessionList = sessions.map((s, i) => ({
			id: `s${i}`,
			workshopId: `w${s.workshop}`,
			startsAt: s.start * hour,
			endsAt: (s.start + s.length) * hour,
			capacity: s.capacity,
			ageGroupIds: s.ageGroup ? [s.ageGroup] : [],
		}))
		const participantList = participants.map((p, i) => ({
			id: `p${i}`,
			ageGroupId: p.ageGroup,
			submittedAt: p.submittedAt,
		}))
		return {
			participants: participantList,
			sessions: sessionList,
			preferences: Object.fromEntries(
				participants.map((p, i) => [`p${i}`, p.ranking.map((w) => `w${w}`)]),
			),
			locked: lockFirst && sessionList[0] ? [{ participantId: 'p0', sessionId: 's0' }] : [],
			rules: {
				sessionsPerParticipant: shape.sessionsPerParticipant,
				strategy: shape.strategy,
				seed: shape.seed,
				fillUnassigned: shape.fillUnassigned,
			},
		}
	})

const runs = { numRuns: 400 }

describe('allocation invariants', () => {
	it('never exceeds capacity (locked placements excepted)', () => {
		fc.assert(
			fc.property(event, (input) => {
				const result = allocate(input)
				for (const session of input.sessions) {
					const taken = result.assignments.filter((a) => a.sessionId === session.id)
					const lockedHere = taken.filter((a) => a.source === 'locked').length
					expect(taken.length).toBeLessThanOrEqual(Math.max(session.capacity, lockedHere))
				}
			}),
			runs,
		)
	})

	it('never gives overlapping sessions or the same workshop twice', () => {
		fc.assert(
			fc.property(event, (input) => {
				const result = allocate(input)
				const byId = new Map(input.sessions.map((s) => [s.id, s]))
				for (const p of input.participants) {
					const mine = result.assignments.filter((a) => a.participantId === p.id)
					const workshops = mine.map((a) => a.workshopId)
					expect(new Set(workshops).size).toBe(workshops.length)
					for (let i = 0; i < mine.length; i++) {
						for (let j = i + 1; j < mine.length; j++) {
							const a = byId.get(mine[i]?.sessionId ?? '')
							const b = byId.get(mine[j]?.sessionId ?? '')
							if (!a || !b) continue
							expect(a.startsAt < b.endsAt && b.startsAt < a.endsAt).toBe(false)
						}
					}
				}
			}),
			runs,
		)
	})

	it('respects eligibility, rankings and the number of sessions per person', () => {
		fc.assert(
			fc.property(event, (input) => {
				const result = allocate(input)
				const sessions = new Map(input.sessions.map((s) => [s.id, s]))
				const participants = new Map(input.participants.map((p) => [p.id, p]))
				for (const a of result.assignments) {
					if (a.source === 'locked') continue
					const session = sessions.get(a.sessionId)
					const participant = participants.get(a.participantId)
					if (session?.ageGroupIds?.length) {
						expect(session.ageGroupIds).toContain(participant?.ageGroupId)
					}
					if (a.source === 'ranked') {
						expect(input.preferences[a.participantId]?.[(a.rank ?? 0) - 1]).toBe(a.workshopId)
					}
					if (a.source === 'filled') expect(input.rules.fillUnassigned).toBe('any-open')
				}
				for (const p of input.participants) {
					const count = result.assignments.filter((a) => a.participantId === p.id).length
					const unfilled = result.unfilled.find((u) => u.participantId === p.id)?.slots ?? 0
					// Everyone ends with exactly their quota, counting unfilled slots.
					expect(count + unfilled).toBe(Math.max(count, input.rules.sessionsPerParticipant))
				}
			}),
			runs,
		)
	})

	it('keeps every locked placement', () => {
		fc.assert(
			fc.property(event, (input) => {
				const result = allocate(input)
				for (const lock of input.locked ?? []) {
					expect(result.assignments).toContainEqual(
						expect.objectContaining({ ...lock, source: 'locked' }),
					)
				}
			}),
			runs,
		)
	})

	it('is deterministic and independent of input order', () => {
		fc.assert(
			fc.property(event, (input) => {
				const a = allocate(input)
				const b = allocate({
					...input,
					participants: [...input.participants].reverse(),
					sessions: [...input.sessions].reverse(),
				})
				expect(b.assignments).toEqual(a.assignments)
				expect(b.traces).toEqual(a.traces)
			}),
			{ numRuns: 200 },
		)
	})

	it('never leaves a slot empty when a ranked workshop would still have fit', () => {
		// The greedy may not find the best overall plan, but it must not skip an
		// obviously available choice for someone who ends with an empty slot.
		fc.assert(
			fc.property(event, (input) => {
				const result = allocate(input)
				const sessions = input.sessions
				const load = new Map<string, number>()
				for (const a of result.assignments) load.set(a.sessionId, (load.get(a.sessionId) ?? 0) + 1)
				for (const u of result.unfilled) {
					const p = input.participants.find((x) => x.id === u.participantId)
					const mine = result.assignments.filter((a) => a.participantId === u.participantId)
					const held = mine.map((a) => sessions.find((s) => s.id === a.sessionId))
					for (const workshopId of input.preferences[u.participantId] ?? []) {
						if (mine.some((a) => a.workshopId === workshopId)) continue
						const fits = sessions.some(
							(s) =>
								s.workshopId === workshopId &&
								(load.get(s.id) ?? 0) < s.capacity &&
								(!s.ageGroupIds?.length || s.ageGroupIds.includes(p?.ageGroupId ?? '')) &&
								held.every((h) => !h || !(h.startsAt < s.endsAt && s.startsAt < h.endsAt)),
						)
						expect(fits).toBe(false)
					}
				}
			}),
			runs,
		)
	})
})
