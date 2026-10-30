import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

const stubFor = (eventId: string) =>
	env.EVENT_COORDINATOR.get(env.EVENT_COORDINATOR.idFromName(eventId))

describe('EventCoordinator', () => {
	it('answers RPC calls', async () => {
		await expect(stubFor('event-1').ping()).resolves.toBe('pong')
	})

	it('rejects plain HTTP requests', async () => {
		const response = await stubFor('event-1').fetch('https://coordinator/live')
		expect(response.status).toBe(426)
	})

	it('broadcasts to connected sockets', async () => {
		const stub = stubFor('event-2')
		const response = await stub.fetch('https://coordinator/live', {
			headers: { Upgrade: 'websocket' },
		})
		expect(response.status).toBe(101)

		const socket = response.webSocket
		if (!socket) throw new Error('No WebSocket in response')
		socket.accept()
		const received = new Promise<string>((resolve) =>
			socket.addEventListener('message', (event) => resolve(String(event.data))),
		)

		await expect(stub.broadcast('{"type":"seats"}')).resolves.toBe(1)
		await expect(received).resolves.toBe('{"type":"seats"}')
	})

	it('sends staff messages to organizer sockets only', async () => {
		const stub = stubFor('event-3')
		const open = async (staff: boolean) => {
			const response = await stub.fetch('https://coordinator/live', {
				headers: { Upgrade: 'websocket', ...(staff ? { 'X-Live-Channel': 'staff' } : {}) },
			})
			const socket = response.webSocket
			if (!socket) throw new Error('No WebSocket in response')
			socket.accept()
			const messages: string[] = []
			socket.addEventListener('message', (event) => messages.push(String(event.data)))
			return messages
		}
		const publicMessages = await open(false)
		const staffMessages = await open(true)

		await expect(stub.broadcast('{"type":"checkins"}', 'staff')).resolves.toBe(1)
		await expect(stub.broadcast('{"type":"seats"}')).resolves.toBe(2)
		await new Promise((resolve) => setTimeout(resolve, 50))
		expect(publicMessages).toEqual(['{"type":"seats"}'])
		expect(staffMessages).toEqual(['{"type":"checkins"}', '{"type":"seats"}'])
	})
})
