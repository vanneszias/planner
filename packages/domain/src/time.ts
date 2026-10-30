/*
 * Instants are stored as UTC; organizers enter wall-clock times in the event's
 * timezone. These helpers convert between the two with Intl only.
 */

export function isValidTimeZone(timeZone: string): boolean {
	try {
		new Intl.DateTimeFormat('en', { timeZone })
		return true
	} catch {
		return false
	}
}

function offsetMinutes(instant: number, timeZone: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}).formatToParts(instant)
	const get = (type: string) => Number(parts.find((part) => part.type === type)?.value)
	const asUtc = Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		get('hour'),
		get('minute'),
		get('second'),
	)
	return Math.round((asUtc - instant) / 60_000)
}

/** "2027-07-12" + "10:00" in Europe/Brussels → the UTC instant. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
	const [year, month, day] = date.split('-').map(Number)
	const [hour, minute] = time.split(':').map(Number)
	const wallClock = Date.UTC(year as number, (month as number) - 1, day, hour, minute)
	// Two passes settle the offset across DST transitions.
	let instant = wallClock - offsetMinutes(wallClock, timeZone) * 60_000
	instant = wallClock - offsetMinutes(instant, timeZone) * 60_000
	return new Date(instant)
}

/** The UTC instant → { date: "2027-07-12", time: "10:00" } in the event's timezone. */
export function utcToZoned(instant: Date, timeZone: string): { date: string; time: string } {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	}).formatToParts(instant)
	const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
	return {
		date: `${get('year')}-${get('month')}-${get('day')}`,
		time: `${get('hour')}:${get('minute')}`,
	}
}
