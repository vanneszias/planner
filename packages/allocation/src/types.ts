/*
 * The allocation engine's contract (docs/allocation-mvp.md). Plain data in,
 * plain data out: no database, no Cloudflare, no clock.
 */

export type Strategy = 'take-turns' | 'early-birds'
export type FillUnassigned = 'none' | 'any-open'

export type Participant = {
	id: string
	/** Matched against a session's ageGroupIds. */
	ageGroupId?: string | null
	/** When they submitted their ranking (ms). Orders "early birds first". */
	submittedAt?: number | null
}

export type Session = {
	id: string
	workshopId: string
	/** Instants in ms; only their order matters. */
	startsAt: number
	endsAt: number
	capacity: number
	/** Empty or absent: open to every participant. */
	ageGroupIds?: string[]
}

export type AllocationInput = {
	participants: Participant[]
	sessions: Session[]
	/** Per participant, workshop ids from most to least wanted. */
	preferences: Record<string, string[]>
	/** Organizer placements the engine must keep; they count against capacity. */
	locked?: { participantId: string; sessionId: string }[]
	rules: {
		sessionsPerParticipant: number
		strategy: Strategy
		seed: string
		fillUnassigned: FillUnassigned
	}
}

export type AssignmentSource = 'locked' | 'ranked' | 'filled'

export type Assignment = {
	participantId: string
	sessionId: string
	workshopId: string
	source: AssignmentSource
	/** 1-based rank of the workshop in the participant's list; null for locked or filled. */
	rank: number | null
	/** The round it was given in (0-based); null for locked. */
	round: number | null
}

/**
 * Why a ranked workshop wasn't given at a turn. Codes, not sentences: the UI
 * translates them, and they never mention other participants (D9).
 */
export type SkipReason =
	| 'full' // every session the participant could attend was full
	| 'overlap' // sessions with room clashed with sessions they already have
	| 'not_eligible' // their age group can't join any session
	| 'no_sessions' // the workshop has no sessions

export type TraceEntry =
	| { round: number; kind: 'assigned'; workshopId: string; rank: number; sessionId: string }
	| { round: number; kind: 'skipped'; workshopId: string; rank: number; reason: SkipReason }
	| { round: number; kind: 'filled'; workshopId: string; sessionId: string }
	| { round: number; kind: 'exhausted' }

export type UnfilledReason =
	| 'preferences_exhausted' // every ranked workshop was taken, full, overlapping or not allowed
	| 'no_open_session' // fill mode found nothing that fits

export type AllocationResult = {
	engineVersion: string
	seed: string
	strategy: Strategy
	assignments: Assignment[]
	unfilled: { participantId: string; slots: number; reason: UnfilledReason }[]
	metrics: AllocationMetrics
	/** Per participant, what happened at each of their turns. */
	traces: Record<string, TraceEntry[]>
	/** Problems with the input itself, e.g. locked placements over capacity. */
	warnings: AllocationWarning[]
}

export type AllocationWarning =
	| { kind: 'locked_over_capacity'; sessionId: string }
	| { kind: 'unknown_session'; participantId: string; sessionId: string }
	| { kind: 'unknown_workshop'; participantId: string; workshopId: string }

export type AllocationMetrics = {
	participants: number
	slotsRequested: number
	slotsFilled: number
	unfilledSlots: number
	participantsWithUnfilled: number
	/** Share of participants (with at least one ranking) who got their first choice. */
	firstChoiceShare: number
	/** rankCounts[i] = ranked assignments that were the participant's (i+1)th choice. */
	rankCounts: number[]
	averageRank: number | null
	filled: number
	/** The participant with the worst outcome: most unfilled slots, then highest rank sum. */
	worstOff: { participantId: string; ranks: (number | null)[]; unfilled: number } | null
}
