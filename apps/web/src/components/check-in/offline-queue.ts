/**
 * Scans that couldn't be sent for lack of a connection (D17: check-in is
 * online-only, so this only bridges short drops). Kept in localStorage per
 * event until they go through. Holds codes and IDs, never names.
 */
export type QueuedScan = {
	sessionId: string | null
	scan?: string
	registrationId?: string
	at: number
}

const key = (eventId: string) => `checkin-queue:${eventId}`
/** Scans older than this are dropped: by then someone used the printed list. */
const maxAge = 6 * 60 * 60 * 1000

export function readQueue(eventId: string): QueuedScan[] {
	try {
		const items = JSON.parse(localStorage.getItem(key(eventId)) ?? '[]') as QueuedScan[]
		return items.filter((item) => Date.now() - item.at < maxAge)
	} catch {
		return []
	}
}

export function writeQueue(eventId: string, items: QueuedScan[]): void {
	if (items.length === 0) localStorage.removeItem(key(eventId))
	else localStorage.setItem(key(eventId), JSON.stringify(items))
}

/** fetch() rejects with a TypeError when the request never reached the server. */
export const isOffline = (error: unknown) => !navigator.onLine || error instanceof TypeError
