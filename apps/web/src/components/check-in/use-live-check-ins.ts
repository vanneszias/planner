import type { CheckInCounts } from '@app/domain'
import { useEffect, useState } from 'react'

/**
 * Check-in counts that update as other volunteers scan (A5), over the
 * organizer-only channel of the event's live socket. If it drops, the screen
 * keeps its last counts and every own scan refreshes them anyway.
 */
export function useLiveCheckIns(eventId: string, initial: CheckInCounts) {
	const [counts, setCounts] = useState(initial)
	useEffect(() => setCounts(initial), [initial])

	useEffect(() => {
		let socket: WebSocket | undefined
		let retry: ReturnType<typeof setTimeout> | undefined
		let stopped = false
		const connect = () => {
			const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
			socket = new WebSocket(`${protocol}://${location.host}/api/live/${eventId}?staff=1`)
			socket.onmessage = (message) => {
				const data = JSON.parse(String(message.data)) as { type?: string; counts?: CheckInCounts }
				if (data.type === 'checkins' && data.counts) setCounts(data.counts)
			}
			socket.onclose = () => {
				if (!stopped) retry = setTimeout(connect, 5000)
			}
		}
		connect()
		return () => {
			stopped = true
			clearTimeout(retry)
			socket?.close()
		}
	}, [eventId])

	return counts
}
