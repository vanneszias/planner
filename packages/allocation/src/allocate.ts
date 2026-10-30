import { seededRandom, shuffle } from './random.ts'
import type {
	AllocationInput,
	AllocationMetrics,
	AllocationResult,
	AllocationWarning,
	Assignment,
	Participant,
	Session,
	SkipReason,
	TraceEntry,
	UnfilledReason,
} from './types.ts'

/** Bump when a change could alter results for the same input and seed. */
export const ENGINE_VERSION = '1.0.0'

type Holding = { sessions: Session[]; workshops: Set<string> }

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const overlaps = (a: Session, b: Session) => a.startsAt < b.endsAt && b.startsAt < a.endsAt

/**
 * Snake draft (docs/allocation-mvp.md): participants take turns, best
 * still-feasible ranked workshop per turn, order reversing each round.
 * Deterministic for a given input, seed and ENGINE_VERSION; the order of the
 * input arrays doesn't matter, only each participant's ranking does.
 */
export function allocate(input: AllocationInput): AllocationResult {
	const { rules } = input
	const random = seededRandom(rules.seed)
	const participants = [...input.participants].sort(byId)
	const sessions = [...input.sessions].sort(byId)
	const sessionById = new Map(sessions.map((s) => [s.id, s]))
	const sessionsByWorkshop = new Map<string, Session[]>()
	for (const session of sessions) {
		const list = sessionsByWorkshop.get(session.workshopId) ?? []
		list.push(session)
		sessionsByWorkshop.set(session.workshopId, list)
	}
	for (const list of sessionsByWorkshop.values()) {
		list.sort((a, b) => a.startsAt - b.startsAt || byId(a, b))
	}

	const load = new Map<string, number>()
	const holdings = new Map<string, Holding>(
		participants.map((p) => [p.id, { sessions: [], workshops: new Set() }]),
	)
	const assignments: Assignment[] = []
	const traces: Record<string, TraceEntry[]> = Object.fromEntries(
		participants.map((p) => [p.id, []]),
	)
	const warnings: AllocationWarning[] = []
	const seenSkips = new Set<string>()

	const freeSeats = (s: Session) => s.capacity - (load.get(s.id) ?? 0)
	const eligible = (p: Participant, s: Session) =>
		!s.ageGroupIds?.length || (p.ageGroupId != null && s.ageGroupIds.includes(p.ageGroupId))
	const fitsWith = (held: Session[], s: Session) => held.every((h) => !overlaps(h, s))
	const holdingOf = (p: Participant) => holdings.get(p.id) as Holding
	const give = (
		p: Participant,
		s: Session,
		assignment: Omit<Assignment, 'participantId' | 'sessionId' | 'workshopId'>,
	) => {
		const holding = holdingOf(p)
		holding.sessions.push(s)
		holding.workshops.add(s.workshopId)
		load.set(s.id, (load.get(s.id) ?? 0) + 1)
		assignments.push({
			participantId: p.id,
			sessionId: s.id,
			workshopId: s.workshopId,
			...assignment,
		})
	}

	// 1. Locked placements: kept as they are, counted against capacity.
	const participantById = new Map(participants.map((p) => [p.id, p]))
	const locked = [...(input.locked ?? [])].sort(
		(a, b) =>
			a.participantId.localeCompare(b.participantId) || a.sessionId.localeCompare(b.sessionId),
	)
	const overCapacity = new Set<string>()
	for (const lock of locked) {
		const participant = participantById.get(lock.participantId)
		const session = sessionById.get(lock.sessionId)
		if (!participant || !session) {
			warnings.push({
				kind: 'unknown_session',
				participantId: lock.participantId,
				sessionId: lock.sessionId,
			})
			continue
		}
		give(participant, session, { source: 'locked', rank: null, round: null })
		if (freeSeats(session) < 0 && !overCapacity.has(session.id)) {
			overCapacity.add(session.id)
			warnings.push({ kind: 'locked_over_capacity', sessionId: session.id })
		}
	}

	// 2. Rankings: known workshops only, first mention wins.
	const rankings = new Map<string, string[]>()
	for (const participant of participants) {
		const seen = new Set<string>()
		const list: string[] = []
		for (const workshopId of input.preferences[participant.id] ?? []) {
			if (seen.has(workshopId)) continue
			seen.add(workshopId)
			if (!sessionsByWorkshop.has(workshopId)) {
				warnings.push({ kind: 'unknown_workshop', participantId: participant.id, workshopId })
			}
			list.push(workshopId)
		}
		rankings.set(participant.id, list)
	}

	// 3. Turn order.
	const order =
		rules.strategy === 'early-birds'
			? shuffle(participants, random).sort(
					(a, b) =>
						(a.submittedAt ?? Number.POSITIVE_INFINITY) -
						(b.submittedAt ?? Number.POSITIVE_INFINITY),
				)
			: shuffle(participants, random)

	const need = new Map(
		participants.map((p) => [
			p.id,
			Math.max(0, rules.sessionsPerParticipant - holdingOf(p).sessions.length),
		]),
	)

	const skip = (
		p: Participant,
		round: number,
		workshopId: string,
		rank: number,
		reason: SkipReason,
	) => {
		// Record each (workshop, reason) once: later rounds would only repeat it.
		const key = `${p.id}\u0000${workshopId}\u0000${reason}`
		if (seenSkips.has(key)) return
		seenSkips.add(key)
		traces[p.id]?.push({ round, kind: 'skipped', workshopId, rank, reason })
	}

	/** Sessions of a workshop this participant could take right now, and why not if none. */
	const options = (p: Participant, workshopId: string): Session[] | SkipReason => {
		const all = sessionsByWorkshop.get(workshopId)
		if (!all?.length) return 'no_sessions'
		const allowed = all.filter((s) => eligible(p, s))
		if (allowed.length === 0) return 'not_eligible'
		const withRoom = allowed.filter((s) => freeSeats(s) > 0)
		if (withRoom.length === 0) return 'full'
		const fitting = withRoom.filter((s) => fitsWith(holdingOf(p).sessions, s))
		return fitting.length === 0 ? 'overlap' : fitting
	}

	/**
	 * Among sessions of the chosen workshop, prefer the one that keeps the most
	 * of the participant's other ranked workshops possible, then the emptiest,
	 * then the earliest.
	 */
	const bestSession = (p: Participant, candidates: Session[], remaining: string[]): Session => {
		let best: Session | undefined
		let bestScore: [number, number, number] | undefined
		for (const candidate of candidates) {
			const held = [...holdingOf(p).sessions, candidate]
			let stillPossible = 0
			for (const workshopId of remaining) {
				const sessionsOfWorkshop = sessionsByWorkshop.get(workshopId) ?? []
				if (
					sessionsOfWorkshop.some((s) => eligible(p, s) && freeSeats(s) > 0 && fitsWith(held, s))
				) {
					stillPossible++
				}
			}
			const score: [number, number, number] = [
				stillPossible,
				freeSeats(candidate),
				-candidate.startsAt,
			]
			if (
				!bestScore ||
				score[0] > bestScore[0] ||
				(score[0] === bestScore[0] &&
					(score[1] > bestScore[1] || (score[1] === bestScore[1] && score[2] > bestScore[2])))
			) {
				best = candidate
				bestScore = score
			}
		}
		return best as Session
	}

	// 4. Ranked rounds (snake).
	const exhausted = new Set<string>()
	for (let round = 0; round < rules.sessionsPerParticipant; round++) {
		const turnOrder = round % 2 === 0 ? order : [...order].reverse()
		for (const p of turnOrder) {
			if ((need.get(p.id) ?? 0) <= 0 || exhausted.has(p.id)) continue
			const ranking = rankings.get(p.id) ?? []
			let given = false
			for (const [index, workshopId] of ranking.entries()) {
				if (holdingOf(p).workshops.has(workshopId)) continue
				const result = options(p, workshopId)
				if (typeof result === 'string') {
					skip(p, round, workshopId, index + 1, result)
					continue
				}
				const remaining = ranking.filter((w, i) => i !== index && !holdingOf(p).workshops.has(w))
				const session = bestSession(p, result, remaining)
				give(p, session, { source: 'ranked', rank: index + 1, round })
				traces[p.id]?.push({
					round,
					kind: 'assigned',
					workshopId,
					rank: index + 1,
					sessionId: session.id,
				})
				need.set(p.id, (need.get(p.id) ?? 0) - 1)
				given = true
				break
			}
			if (!given) {
				exhausted.add(p.id)
				traces[p.id]?.push({ round, kind: 'exhausted' })
			}
		}
	}

	// 5. Optional fill with any session that still has room (D10).
	const noOpenSession = new Set<string>()
	if (rules.fillUnassigned === 'any-open') {
		for (let round = 0; round < rules.sessionsPerParticipant; round++) {
			const turnOrder = round % 2 === 0 ? order : [...order].reverse()
			for (const p of turnOrder) {
				if ((need.get(p.id) ?? 0) <= 0 || noOpenSession.has(p.id)) continue
				const holding = holdingOf(p)
				let pick: Session | undefined
				for (const s of sessions) {
					if (holding.workshops.has(s.workshopId) || !eligible(p, s) || freeSeats(s) <= 0) continue
					if (!fitsWith(holding.sessions, s)) continue
					if (
						!pick ||
						freeSeats(s) > freeSeats(pick) ||
						(freeSeats(s) === freeSeats(pick) && s.startsAt < pick.startsAt)
					) {
						pick = s
					}
				}
				if (!pick) {
					noOpenSession.add(p.id)
					continue
				}
				give(p, pick, { source: 'filled', rank: null, round })
				traces[p.id]?.push({
					round,
					kind: 'filled',
					workshopId: pick.workshopId,
					sessionId: pick.id,
				})
				need.set(p.id, (need.get(p.id) ?? 0) - 1)
			}
		}
	}

	const unfilled = participants.flatMap((p) => {
		const slots = need.get(p.id) ?? 0
		if (slots <= 0) return []
		const reason: UnfilledReason =
			rules.fillUnassigned === 'any-open' ? 'no_open_session' : 'preferences_exhausted'
		return [{ participantId: p.id, slots, reason }]
	})

	return {
		engineVersion: ENGINE_VERSION,
		seed: rules.seed,
		strategy: rules.strategy,
		assignments,
		unfilled,
		metrics: metricsFor(
			participants,
			rankings,
			assignments,
			unfilled,
			rules.sessionsPerParticipant,
		),
		traces,
		warnings,
	}
}

function metricsFor(
	participants: Participant[],
	rankings: Map<string, string[]>,
	assignments: Assignment[],
	unfilled: AllocationResult['unfilled'],
	sessionsPerParticipant: number,
): AllocationMetrics {
	const ranksByParticipant = new Map<string, (number | null)[]>()
	const rankCounts: number[] = []
	let filled = 0
	for (const a of assignments) {
		if (a.source === 'locked') continue
		if (a.source === 'filled') filled++
		if (a.rank !== null) rankCounts[a.rank - 1] = (rankCounts[a.rank - 1] ?? 0) + 1
		ranksByParticipant.set(a.participantId, [
			...(ranksByParticipant.get(a.participantId) ?? []),
			a.rank,
		])
	}
	for (let i = 0; i < rankCounts.length; i++) rankCounts[i] ??= 0

	const ranked = participants.filter((p) => (rankings.get(p.id)?.length ?? 0) > 0)
	const gotFirst = ranked.filter((p) => ranksByParticipant.get(p.id)?.includes(1)).length
	const rankedTotal = rankCounts.reduce((sum, count, i) => sum + count * (i + 1), 0)
	const rankedCount = rankCounts.reduce((sum, count) => sum + count, 0)
	const unfilledOf = new Map(unfilled.map((u) => [u.participantId, u.slots]))

	let worstOff: AllocationMetrics['worstOff'] = null
	let worstScore = -1
	for (const p of participants) {
		const ranks = ranksByParticipant.get(p.id) ?? []
		const missing = unfilledOf.get(p.id) ?? 0
		// Unfilled slots weigh more than any rank; then the sum of ranks (filled counts as worst rank + 1).
		const score =
			missing * 1000 +
			ranks.reduce<number>((sum, r) => sum + (r ?? (rankings.get(p.id)?.length ?? 0) + 1), 0)
		if (score > worstScore) {
			worstScore = score
			worstOff = { participantId: p.id, ranks, unfilled: missing }
		}
	}

	const slotsFilled = assignments.filter((a) => a.source !== 'locked').length
	const unfilledSlots = unfilled.reduce((sum, u) => sum + u.slots, 0)
	return {
		participants: participants.length,
		slotsRequested: slotsFilled + unfilledSlots,
		slotsFilled,
		unfilledSlots,
		participantsWithUnfilled: unfilled.length,
		firstChoiceShare: ranked.length ? gotFirst / ranked.length : 0,
		rankCounts,
		averageRank: rankedCount ? rankedTotal / rankedCount : null,
		filled,
		worstOff: participants.length && sessionsPerParticipant > 0 ? worstOff : null,
	}
}
