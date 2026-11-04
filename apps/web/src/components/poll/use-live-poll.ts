import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'

/**
 * Refetches the page when someone else answers or the organizer decides. The
 * socket only says "changed"; the data comes from the normal loader, so a
 * dropped connection just means updates show on the next load.
 */
export function useLivePoll(shareCode: string) {
	const router = useRouter()
	useEffect(() => {
		let socket: WebSocket | undefined
		let retry: ReturnType<typeof setTimeout> | undefined
		let stopped = false
		const connect = () => {
			const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
			socket = new WebSocket(`${protocol}://${location.host}/api/live/poll/${shareCode}`)
			socket.onmessage = () => router.invalidate()
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
	}, [shareCode, router])
}
