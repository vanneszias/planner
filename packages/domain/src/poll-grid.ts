import { zonedToUtc } from './time.ts'

/*
 * The availability grid, window ranking and calendar file for polls. Pure and
 * free of database imports, so the browser uses the same code as the server
 * (import from `@app/domain/poll-grid`).
 */

export const cellMinutes = 30

export type PollShape = {
	timezone: string
	startsOn: string
	endsOn: string
	dayStartMinutes: number
	dayEndMinutes: number
	durationMinutes: number
}

export type Availability = { free: number[]; ifNeeded: number[] }
export type Mark = 'free' | 'ifNeeded'

export type Cell = { date: string; minutes: number; startsAt: number }

/** 1170 → "19:30"; 1440 → "24:00". */
export function minutesToTime(minutes: number): string {
	const h = Math.floor(minutes / 60)
	const m = minutes % 60
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** "19:30" → 1170; also accepts "24:00". Null for anything else. */
export function timeToMinutes(time: string): number | null {
	const match = /^(\d{2}):(\d{2})$/.exec(time)
	if (!match) return null
	const minutes = Number(match[1]) * 60 + Number(match[2])
	if (Number(match[2]) > 59 || minutes > 1440) return null
	return minutes
}

/** Every date from startsOn to endsOn, inclusive (YYYY-MM-DD). */
export function pollDates(shape: Pick<PollShape, 'startsOn' | 'endsOn'>): string[] {
	const dates: string[] = []
	const day = new Date(`${shape.startsOn}T12:00:00Z`)
	const last = new Date(`${shape.endsOn}T12:00:00Z`)
	while (day <= last && dates.length < 366) {
		dates.push(day.toISOString().slice(0, 10))
		day.setUTCDate(day.getUTCDate() + 1)
	}
	return dates
}

/** Daily row starts, in minutes after midnight: one per 30-minute cell. */
export function rowMinutes(shape: Pick<PollShape, 'dayStartMinutes' | 'dayEndMinutes'>): number[] {
	const rows: number[] = []
	for (let m = shape.dayStartMinutes; m + cellMinutes <= shape.dayEndMinutes; m += cellMinutes) {
		rows.push(m)
	}
	return rows
}

const instant = (shape: Pick<PollShape, 'timezone'>, date: string, minutes: number) =>
	zonedToUtc(date, minutesToTime(minutes), shape.timezone).getTime()

/** Every cell of the grid, day by day, earliest first. */
export function pollCells(shape: PollShape): Cell[] {
	const rows = rowMinutes(shape)
	return pollDates(shape).flatMap((date) =>
		rows.map((minutes) => ({ date, minutes, startsAt: instant(shape, date, minutes) })),
	)
}

/** Keeps only marks on real cells, drops duplicates, and lets "free" win over "if needed". */
export function cleanAvailability(shape: PollShape, input: Availability): Availability {
	const cells = new Set(pollCells(shape).map((c) => c.startsAt))
	const free = [...new Set(input.free)].filter((t) => cells.has(t)).sort((a, b) => a - b)
	const freeSet = new Set(free)
	const ifNeeded = [...new Set(input.ifNeeded)]
		.filter((t) => cells.has(t) && !freeSet.has(t))
		.sort((a, b) => a - b)
	return { free, ifNeeded }
}

export type Respondent = { id: string; name: string; availability: Availability }

export type RankedWindow = {
	date: string
	minutes: number
	startsAt: number
	endsAt: number
	/** Respondent ids free for the whole window. */
	free: string[]
	/** Respondent ids who can make it, but only "if needed" for part of it. */
	ifNeeded: string[]
}

/**
 * Every start time where the whole evening fits in one day's grid, best
 * first: the most people who can come, then the most who are truly free
 * (not just "if needed"), then the earliest.
 */
export function rankWindows(shape: PollShape, respondents: readonly Respondent[]): RankedWindow[] {
	const marks = respondents.map((r) => ({
		id: r.id,
		free: new Set(r.availability.free),
		ifNeeded: new Set(r.availability.ifNeeded),
	}))
	const rows = rowMinutes(shape)
	const steps = shape.durationMinutes / cellMinutes
	const windows: RankedWindow[] = []

	for (const date of pollDates(shape)) {
		const starts = rows.map((m) => instant(shape, date, m))
		for (let i = 0; i + steps <= rows.length; i++) {
			const minutes = rows[i] as number
			const cells = starts.slice(i, i + steps)
			const free: string[] = []
			const ifNeeded: string[] = []
			for (const person of marks) {
				if (cells.every((c) => person.free.has(c))) free.push(person.id)
				else if (cells.every((c) => person.free.has(c) || person.ifNeeded.has(c)))
					ifNeeded.push(person.id)
			}
			windows.push({
				date,
				minutes,
				startsAt: cells[0] as number,
				endsAt: instant(shape, date, minutes + shape.durationMinutes),
				free,
				ifNeeded,
			})
		}
	}

	return windows.sort(
		(a, b) =>
			b.free.length + b.ifNeeded.length - (a.free.length + a.ifNeeded.length) ||
			b.free.length - a.free.length ||
			a.startsAt - b.startsAt,
	)
}

export const attendance = (window: Pick<RankedWindow, 'free' | 'ifNeeded'>) =>
	window.free.length + window.ifNeeded.length

/** Per cell: who marked it free and who "if needed", for the heatmap. */
export function cellTallies(respondents: readonly Respondent[]) {
	const tallies = new Map<number, { free: string[]; ifNeeded: string[] }>()
	const at = (t: number) => {
		let tally = tallies.get(t)
		if (!tally) {
			tally = { free: [], ifNeeded: [] }
			tallies.set(t, tally)
		}
		return tally
	}
	for (const r of respondents) {
		for (const t of r.availability.free) at(t).free.push(r.id)
		for (const t of r.availability.ifNeeded) at(t).ifNeeded.push(r.id)
	}
	return tallies
}

/** iCalendar text (RFC 5545) for a confirmed evening. */
export function pollCalendarFile(input: {
	uid: string
	title: string
	description: string
	location: string
	startsAt: number
	endsAt: number
	url?: string
	now?: number
}): string {
	const stamp = (t: number) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
	const escapeText = (text: string) =>
		text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//planner//availability poll//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'BEGIN:VEVENT',
		`UID:${input.uid}`,
		`DTSTAMP:${stamp(input.now ?? Date.now())}`,
		`DTSTART:${stamp(input.startsAt)}`,
		`DTEND:${stamp(input.endsAt)}`,
		`SUMMARY:${escapeText(input.title)}`,
		input.location && `LOCATION:${escapeText(input.location)}`,
		input.description && `DESCRIPTION:${escapeText(input.description)}`,
		input.url && `URL:${input.url}`,
		'END:VEVENT',
		'END:VCALENDAR',
	].filter((line): line is string => Boolean(line))
	return `${lines.map(fold).join('\r\n')}\r\n`
}

/** Folds lines longer than 75 octets, as the spec requires. */
function fold(line: string): string {
	const bytes = new TextEncoder().encode(line)
	if (bytes.length <= 75) return line
	const parts: string[] = []
	let current = ''
	let size = 0
	for (const char of line) {
		const charSize = new TextEncoder().encode(char).length
		const limit = parts.length === 0 ? 75 : 74
		if (size + charSize > limit) {
			parts.push(current)
			current = ''
			size = 0
		}
		current += char
		size += charSize
	}
	parts.push(current)
	return parts.join('\r\n ')
}
