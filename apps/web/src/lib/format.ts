import { getLocale } from '#/paraglide/runtime'

const locale = () => (getLocale() === 'nl' ? 'nl-BE' : 'en-GB')

/** "12–13 July 2027" style range for event dates (YYYY-MM-DD, no timezone shift). */
export function formatDateRange(startsOn: string, endsOn: string): string {
	const start = new Date(`${startsOn}T12:00:00Z`)
	const end = new Date(`${endsOn}T12:00:00Z`)
	const format = new Intl.DateTimeFormat(locale(), {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC',
	})
	return startsOn === endsOn ? format.format(start) : format.formatRange(start, end)
}

/** "Saturday 12 July" for a day heading, in the event's timezone. */
export function formatDay(instant: Date, timeZone: string): string {
	return new Intl.DateTimeFormat(locale(), {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		timeZone,
	}).format(instant)
}

/** "10:00" in the event's timezone, 24-hour. */
export function formatTime(instant: Date, timeZone: string): string {
	return new Intl.DateTimeFormat(locale(), {
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
		timeZone,
	}).format(instant)
}

/** Groups items by their day in the event's timezone, keeping order. */
export function groupByDay<T extends { startsAt: Date }>(items: T[], timeZone: string) {
	const days = new Map<string, { label: string; items: T[] }>()
	for (const item of items) {
		const key = new Intl.DateTimeFormat('en-CA', { timeZone }).format(item.startsAt)
		const day = days.get(key) ?? { label: formatDay(item.startsAt, timeZone), items: [] }
		day.items.push(item)
		days.set(key, day)
	}
	return [...days.values()]
}
