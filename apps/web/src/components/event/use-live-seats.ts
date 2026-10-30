import { useEffect, useState } from 'react'

/**
 * Seat counts that update while the page is open (A5). The socket is a hint:
 * if it drops, the page still has the counts from its last load, and every
 * action refetches anyway.
 */
export function useLiveSeats(eventId: string, initial: Record<string, number>) {
	const [seats, setSeats] = useState(initial)
	useEffect(() => setSeats(initial), [initial])

	useEffect(() => {
		let socket: WebSocket | undefined
		let retry: ReturnType<typeof setTimeout> | undefined
		let stopped = false
		const connect = () => {
			const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
			socket = new WebSocket(`${protocol}://${location.host}/api/live/${eventId}`)
			socket.onmessage = (message) => {
				const data = JSON.parse(String(message.data)) as {
					type?: string
					seats?: Record<string, number>
				}
				if (data.type === 'seats' && data.seats) setSeats(data.seats)
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

	return seats
}
