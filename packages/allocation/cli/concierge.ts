import type { AllocationInput, AllocationResult, Strategy } from '../src/index.ts'
import { csvCell, parseCsv, toCsv } from './csv.ts'

/*
 * Concierge allocation (decision D18): turn an organizer's spreadsheets into
 * an engine input, and the result back into spreadsheets they can use.
 *
 * sessions.csv:     workshop, date (YYYY-MM-DD), start (HH:MM), end, capacity,
 *                   room (optional), age groups (optional, separated by |)
 * participants.csv: name, age group (optional), choice 1 … choice N,
 *                   submitted (optional, for "early birds first")
 */

export type ConciergeOptions = {
	sessionsPerParticipant: number
	strategy: Strategy
	fillUnassigned: 'none' | 'any-open'
	seed: string
}

export type SessionInfo = {
	workshop: string
	date: string
	start: string
	end: string
	room: string
}

export type ConciergeInput = {
	input: AllocationInput
	names: Map<string, string>
	sessionInfo: Map<string, SessionInfo>
	workshopNames: Map<string, string>
	problems: string[]
}

const key = (name: string) => name.trim().toLowerCase()

export function fromCsv(
	sessionsCsv: string,
	participantsCsv: string,
	options: ConciergeOptions,
): ConciergeInput {
	const problems: string[] = []
	const workshopNames = new Map<string, string>()
	const sessionInfo = new Map<string, SessionInfo>()

	const sessions = parseCsv(sessionsCsv).flatMap((row, index) => {
		const workshop = row.workshop ?? ''
		const date = row.date ?? ''
		const start = row.start ?? ''
		const end = row.end ?? ''
		const capacity = Number(row.capacity)
		const line = index + 2
		if (
			!workshop ||
			!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
			!/^\d{1,2}:\d{2}$/.test(start) ||
			!/^\d{1,2}:\d{2}$/.test(end)
		) {
			problems.push(
				`sessions.csv line ${line}: needs workshop, date (YYYY-MM-DD), start and end (HH:MM)`,
			)
			return []
		}
		if (!Number.isInteger(capacity) || capacity < 0) {
			problems.push(`sessions.csv line ${line}: capacity must be a whole number`)
			return []
		}
		const workshopId = key(workshop)
		workshopNames.set(workshopId, workshop)
		const id = `s${index}`
		sessionInfo.set(id, { workshop, date, start, end, room: row.room ?? '' })
		const instant = (time: string) => {
			const [h, m] = time.split(':').map(Number)
			const [y, mo, d] = date.split('-').map(Number)
			return Date.UTC(y as number, (mo as number) - 1, d, h, m)
		}
		const ageGroups = (row['age groups'] ?? '').split('|').map(key).filter(Boolean)
		return [
			{
				id,
				workshopId,
				startsAt: instant(start),
				endsAt: instant(end),
				capacity,
				ageGroupIds: ageGroups,
			},
		]
	})

	const names = new Map<string, string>()
	const preferences: Record<string, string[]> = {}
	const participants = parseCsv(participantsCsv).flatMap((row, index) => {
		const name = row.name ?? ''
		if (!name) {
			problems.push(`participants.csv line ${index + 2}: missing name`)
			return []
		}
		const id = `p${index}`
		names.set(id, name)
		const choices = Object.keys(row)
			.filter((column) => /^choice\s*\d+$/.test(column))
			.sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')))
			.map((column) => row[column] ?? '')
			.filter(Boolean)
		preferences[id] = choices.map((choice) => {
			if (!workshopNames.has(key(choice))) {
				problems.push(
					`participants.csv line ${index + 2}: "${choice}" is not a workshop in sessions.csv`,
				)
			}
			return key(choice)
		})
		const submitted = row.submitted ? Date.parse(row.submitted) : Number.NaN
		return [
			{
				id,
				ageGroupId: row['age group'] ? key(row['age group']) : null,
				submittedAt: Number.isNaN(submitted) ? null : submitted,
			},
		]
	})

	return {
		input: { participants, sessions, preferences, rules: options },
		names,
		sessionInfo,
		workshopNames,
		problems,
	}
}

const ordinal = (rank: number | null) => (rank === null ? 'filled' : `choice ${rank}`)

/** One row per participant: their sessions in time order, with the choice each was. */
export function programmeCsv(data: ConciergeInput, result: AllocationResult): string {
	const { names, sessionInfo, input } = data
	const slots = input.rules.sessionsPerParticipant
	const header = ['name']
	for (let i = 1; i <= slots; i++) header.push(`session ${i}`, `when ${i}`, `room ${i}`, `was ${i}`)
	header.push('empty slots')
	const rows: (string | number)[][] = [header]
	for (const participant of input.participants) {
		const mine = result.assignments
			.filter((a) => a.participantId === participant.id)
			.map((a) => ({ a, info: sessionInfo.get(a.sessionId) as SessionInfo }))
			.sort((x, y) =>
				`${x.info.date} ${x.info.start}`.localeCompare(`${y.info.date} ${y.info.start}`),
			)
		const row: (string | number)[] = [names.get(participant.id) ?? participant.id]
		for (let i = 0; i < slots; i++) {
			const item = mine[i]
			row.push(
				item?.info.workshop ?? '',
				item ? `${item.info.date} ${item.info.start}–${item.info.end}` : '',
				item?.info.room ?? '',
				item ? ordinal(item.a.rank) : '',
			)
		}
		row.push(result.unfilled.find((u) => u.participantId === participant.id)?.slots ?? 0)
		rows.push(row)
	}
	return toCsv(rows)
}

/** One row per session: who's in it, for printing attendance lists. */
export function rostersCsv(data: ConciergeInput, result: AllocationResult): string {
	const rows: (string | number)[][] = [
		['workshop', 'date', 'start', 'end', 'room', 'capacity', 'assigned', 'names'],
	]
	for (const session of data.input.sessions) {
		const info = data.sessionInfo.get(session.id) as SessionInfo
		const people = result.assignments
			.filter((a) => a.sessionId === session.id)
			.map((a) => data.names.get(a.participantId) ?? a.participantId)
			.sort((a, b) => a.localeCompare(b))
		rows.push([
			info.workshop,
			info.date,
			info.start,
			info.end,
			info.room,
			session.capacity,
			people.length,
			people.join('; '),
		])
	}
	return toCsv(rows)
}

/** A plain-language summary for the organizer. */
export function summary(data: ConciergeInput, result: AllocationResult): string {
	const m = result.metrics
	const ranks = m.rankCounts.map((count, i) => `choice ${i + 1}: ${count}`).join(', ')
	return [
		`${m.participants} participants, ${m.slotsRequested} places to fill (${data.input.rules.sessionsPerParticipant} each).`,
		`${Math.round(m.firstChoiceShare * 100)}% got their first choice. ${ranks || 'No ranked places.'}`,
		m.filled ? `${m.filled} places were filled with a workshop nobody ranked.` : '',
		m.unfilledSlots
			? `${m.unfilledSlots} places stay empty for ${m.participantsWithUnfilled} participants: everything they ranked was full, at the same time as something else, or not for their age group.`
			: 'Every place is filled.',
		`Strategy: ${result.strategy}. Seed: ${csvCell(result.seed)} (rerun with the same seed for the same result).`,
	]
		.filter(Boolean)
		.join('\n')
}
