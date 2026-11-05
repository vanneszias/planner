import { m } from '#/paraglide/messages'
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

/** "Saturday 3 May, 10:00" in the event's timezone. */
export function formatDateTime(instant: Date, timeZone: string): string {
	return `${formatDay(instant, timeZone)}, ${formatTime(instant, timeZone)}`
}

/** "Sat 10:00": compact, for lists of session times. */
export function formatShortDayTime(instant: Date, timeZone: string): string {
	const day = new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone }).format(instant)
	return `${day} ${formatTime(instant, timeZone)}`
}

/** "30 Oct 2026, 13:05" in the viewer's own timezone, for things like exports and the audit log. */
export function formatStamp(at: number): string {
	return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(at)
}

/** Groups one day's items by identical start and end time, keeping order of first appearance. */
export function groupBySlot<T extends { startsAt: Date; endsAt: Date }>(items: T[]) {
	const slots = new Map<string, { startsAt: Date; endsAt: Date; items: T[] }>()
	for (const item of items) {
		const key = `${item.startsAt.getTime()}-${item.endsAt.getTime()}`
		const slot = slots.get(key) ?? { startsAt: item.startsAt, endsAt: item.endsAt, items: [] }
		slot.items.push(item)
		slots.set(key, slot)
	}
	return [...slots.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
}

/** "13:05" in the viewer's own timezone. */
export function formatClock(at: number): string {
	return new Intl.DateTimeFormat(locale(), { timeStyle: 'short' }).format(at)
}

/** "Wednesday 4 November 2026" in the viewer's own timezone, for day headings in logs. */
export function formatDayStamp(at: number): string {
	return new Intl.DateTimeFormat(locale(), { dateStyle: 'full' }).format(at)
}

/** "1 session" / "3 sessions". */
export function sessionCount(count: number): string {
	return count === 1 ? m.one_session() : m.workshop_sessions({ count: String(count) })
}
