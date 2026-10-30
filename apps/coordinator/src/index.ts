import { DurableObject } from 'cloudflare:workers'

/**
 * One instance per event (see docs/architecture.md). Serialises the event's
 * writes and pushes live updates to connected browsers. D1 stays the source
 * of truth; this object holds no state that can't be rebuilt from it.
 *
 * Address it with `env.EVENT_COORDINATOR.jurisdiction('eu').idFromName(eventId)`.
 */
export class EventCoordinator extends DurableObject<Env> {
	/** RPC placeholder until bookings land in M3. */
	async ping(): Promise<'pong'> {
		return 'pong'
	}

	/** Sends a message to every connected browser. Messages never carry personal data. */
	broadcast(message: string): number {
		const sockets = this.ctx.getWebSockets()
		for (const socket of sockets) socket.send(message)
		return sockets.length
	}

	/** Accepts a WebSocket. The caller (`web`) authenticates the request before forwarding it. */
	override async fetch(request: Request): Promise<Response> {
		if (request.headers.get('Upgrade') !== 'websocket') {
			return new Response('Expected a WebSocket upgrade', { status: 426 })
		}
		const { 0: client, 1: server } = new WebSocketPair()
		// Hibernatable: the object isn't billed while sockets sit idle.
		this.ctx.acceptWebSocket(server)
		return new Response(null, { status: 101, webSocket: client })
	}

	override async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
		socket.close(code, reason)
	}
}

// No public routes: other Workers reach the object through its binding.
export default {
	fetch: () => new Response('Not found', { status: 404 }),
} satisfies ExportedHandler<Env>
