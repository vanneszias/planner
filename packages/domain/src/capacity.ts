/*
 * How many people an event has room for. Pure and free of database imports,
 * so the browser uses the same code as the server (import from
 * `@app/domain/capacity`).
 *
 * Adding up every session's places counts seats, not people: three time slots
 * of 70 places each are 210 seats but room for only 70 people when everyone
 * does three sessions. A person attends at most one session per block of
 * overlapping sessions, so the event holds P people when the blocks together
 * have room for everyone's sessions: sum over blocks of min(places, P) >= P × quota.
 */

export type CapacitySession = {
	startsAt: Date | number | string
	endsAt: Date | number | string
	capacity: number
	status?: 'scheduled' | 'cancelled'
}

/** Places per block of sessions that overlap in time (directly or through each other). */
export function blockCapacities(sessions: readonly CapacitySession[]): number[] {
	const sorted = sessions
		.filter((s) => s.status !== 'cancelled')
		.map((s) => ({
			start: new Date(s.startsAt).getTime(),
			end: new Date(s.endsAt).getTime(),
			capacity: s.capacity,
		}))
		.sort((a, b) => a.start - b.start)
	const blocks: { end: number; capacity: number }[] = []
	for (const s of sorted) {
		const last = blocks.at(-1)
		if (last && s.start < last.end) {
			last.end = Math.max(last.end, s.end)
			last.capacity += s.capacity
		} else {
			blocks.push({ end: s.end, capacity: s.capacity })
		}
	}
	return blocks.map((b) => b.capacity)
}

/**
 * The most people who can each get `perPerson` sessions (or one per block,
 * when there are fewer blocks than that). An upper bound: workshop and age
 * rules can lower it further.
 */
export function peopleCapacity(sessions: readonly CapacitySession[], perPerson: number): number {
	const blocks = blockCapacities(sessions)
	const quota = Math.min(Math.max(1, perPerson), blocks.length)
	if (quota === 0) return 0
	const fits = (people: number) =>
		blocks.reduce((sum, places) => sum + Math.min(places, people), 0) >= people * quota
	// `fits` holds up to the answer and fails after it, so search for the edge.
	let low = 0
	let high = Math.floor(blocks.reduce((sum, places) => sum + places, 0) / quota)
	while (low < high) {
		const mid = Math.ceil((low + high) / 2)
		if (fits(mid)) low = mid
		else high = mid - 1
	}
	return low
}
