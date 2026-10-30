import { seededRandom } from '../src/random.ts'
import type { AllocationInput, Session } from '../src/types.ts'

export type Size = {
	name: string
	participants: number
	workshops: number
	sessionsPerWorkshop: number
	sessionsPerParticipant: number
	rankLimit: number
}

/** The three sizes from docs/allocation-mvp.md. */
export const sizes: Size[] = [
	{
		name: 'target',
		participants: 200,
		workshops: 20,
		sessionsPerWorkshop: 3,
		sessionsPerParticipant: 3,
		rankLimit: 5,
	},
	{
		name: 'large camp',
		participants: 2_000,
		workshops: 100,
		sessionsPerWorkshop: 4,
		sessionsPerParticipant: 3,
		rankLimit: 5,
	},
	{
		name: 'stress',
		participants: 10_000,
		workshops: 300,
		sessionsPerWorkshop: 4,
		sessionsPerParticipant: 3,
		rankLimit: 5,
	},
]

const hour = 3_600_000

/**
 * A synthetic event: seats about 10% above demand, popularity skewed (a few
 * workshops are far more wanted than the rest), sessions spread over six
 * time blocks, a third of workshops limited to one of two age groups.
 */
export function generate(
	size: Size,
	seed = 'bench',
	fillUnassigned: AllocationInput['rules']['fillUnassigned'] = 'none',
): AllocationInput {
	const random = seededRandom(`${seed}:${size.name}`)
	const blocks = 6
	const totalSessions = size.workshops * size.sessionsPerWorkshop
	const capacity = Math.ceil(
		(size.participants * size.sessionsPerParticipant * 1.1) / totalSessions,
	)

	const sessions: Session[] = []
	for (let w = 0; w < size.workshops; w++) {
		const limitedTo = w % 3 === 0 ? [w % 2 === 0 ? 'young' : 'older'] : []
		for (let n = 0; n < size.sessionsPerWorkshop; n++) {
			const block = (w + n * 2) % blocks
			sessions.push({
				id: `s${w}-${n}`,
				workshopId: `w${w}`,
				startsAt: block * 2 * hour,
				endsAt: block * 2 * hour + 75 * 60_000,
				capacity,
				ageGroupIds: limitedTo,
			})
		}
	}

	// Zipf-like popularity: workshop k is chosen with weight 1 / (k + 1).
	const weights = Array.from({ length: size.workshops }, (_, k) => 1 / (k + 1))
	const total = weights.reduce((a, b) => a + b, 0)
	const pick = () => {
		let r = random() * total
		for (let k = 0; k < weights.length; k++) {
			r -= weights[k] as number
			if (r <= 0) return k
		}
		return weights.length - 1
	}

	const participants = []
	const preferences: Record<string, string[]> = {}
	for (let i = 0; i < size.participants; i++) {
		const id = `p${i}`
		participants.push({
			id,
			ageGroupId: random() < 0.5 ? 'young' : 'older',
			submittedAt: Math.floor(random() * 1_000_000),
		})
		// Like the real ranking form: only workshops their age group may join.
		const ageGroupId = participants[i]?.ageGroupId
		const allowed = (w: number) => w % 3 !== 0 || (w % 2 === 0 ? 'young' : 'older') === ageGroupId
		const ranking = new Set<string>()
		while (ranking.size < size.rankLimit) {
			const w = pick()
			if (allowed(w)) ranking.add(`w${w}`)
		}
		preferences[id] = [...ranking]
	}

	return {
		participants,
		sessions,
		preferences,
		rules: {
			sessionsPerParticipant: size.sessionsPerParticipant,
			strategy: 'take-turns',
			seed,
			fillUnassigned,
		},
	}
}
