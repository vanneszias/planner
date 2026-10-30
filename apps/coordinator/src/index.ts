import { DurableObject } from 'cloudflare:workers'
import { createDb } from '@app/db'
import {
	type BookingResult,
	bookSession,
	type CancelResult,
	type CheckInInput,
	type CheckInResult,
	cancelBooking,
	cancelRegistration,
	checkIn,
	checkInCounts,
	joinWaitlist,
	leaveWaitlist,
	type OrganizerContext,
	type ParticipantContext,
	type Promotion,
	publishRun,
	seatCounts,
	undoCheckIn,
} from '@app/domain'
import { apiSecurityHeaders, r2RunStorage } from '@app/platform'

/**
 * One instance per event (see docs/architecture.md). Every booking write for
 * the event goes through here, one at a time, and connected browsers get the
 * new seat counts. D1 stays the source of truth; this object holds nothing
 * that can't be rebuilt from it.
 *
 * Address it through `coordinatorFor()` in @app/platform (EU jurisdiction).
 */
export class EventCoordinator extends DurableObject<Env> {
	/**
	 * A Durable Object handles one request at a time only until that request
	 * awaits I/O, and D1 calls are I/O. Chaining writes keeps them strictly
	 * sequential, which waitlist promotion relies on.
	 */
	private queue: Promise<unknown> = Promise.resolve()

	private serialized<T>(work: () => Promise<T>): Promise<T> {
		const run = this.queue.then(work, work)
		this.queue = run.catch(() => undefined)
		return run
	}

	private db() {
		return createDb(this.env.DB)
	}

	/** RPC health check (used by /health). */
	async ping(): Promise<'pong'> {
		return 'pong'
	}

	async book(context: ParticipantContext, sessionId: string): Promise<BookingResult> {
		return this.serialized(async () => {
			const result = await bookSession(this.db(), context, sessionId)
			if (result.ok) await this.broadcastSeats(context.eventId)
			return result
		})
	}

	async cancel(context: ParticipantContext, sessionId: string): Promise<CancelResult> {
		return this.serialized(async () => {
			const result = await cancelBooking(this.db(), context, sessionId)
			if (result.ok) await this.broadcastSeats(context.eventId)
			return result
		})
	}

	async joinWaitlist(context: ParticipantContext, sessionId: string) {
		return this.serialized(async () => {
			const result = await joinWaitlist(this.db(), context, sessionId)
			// Joining can turn into a booking if a seat had just opened.
			await this.broadcastSeats(context.eventId)
			return result
		})
	}

	async leaveWaitlist(context: ParticipantContext, sessionId: string): Promise<void> {
		return this.serialized(() => leaveWaitlist(this.db(), context, sessionId))
	}

	/** Cancels a whole registration and fills the freed seats from waitlists (D23). */
	async cancelRegistration(context: ParticipantContext): Promise<Promotion[]> {
		return this.serialized(async () => {
			const promotions = await cancelRegistration(this.db(), context)
			await this.broadcastSeats(context.eventId)
			return promotions
		})
	}

	/**
	 * Publishes an allocation run (O6). Serialised with bookings and other
	 * publishes, so two publishes never overlap. The caller (web) has already
	 * checked the organizer's session; the domain checks the role again.
	 */
	async publish(
		context: OrganizerContext,
		eventId: string,
		runId: string,
	): Promise<{ registrationIds: string[] }> {
		return this.serialized(async () => {
			const result = await publishRun(this.db(), r2RunStorage(this.env.FILES), context, runId)
			this.broadcast(JSON.stringify({ type: 'published' }))
			await this.broadcastSeats(eventId)
			return result
		})
	}

	/**
	 * Event day check-in (O8). Serialised with bookings, since "check in
	 * anyway" adds a place; organizer screens get the new counts.
	 */
	async checkIn(
		context: OrganizerContext,
		eventId: string,
		input: CheckInInput,
	): Promise<CheckInResult> {
		return this.serialized(async () => {
			const result = await checkIn(this.db(), context, eventId, input)
			if (result.ok) {
				await this.broadcastCheckIns(eventId)
				if (input.force) await this.broadcastSeats(eventId)
			}
			return result
		})
	}

	async undoCheckIn(
		context: OrganizerContext,
		eventId: string,
		sessionId: string | null,
		registrationId: string,
	): Promise<void> {
		return this.serialized(async () => {
			await undoCheckIn(this.db(), context, eventId, sessionId, registrationId)
			await this.broadcastCheckIns(eventId)
		})
	}

	/**
	 * Sends a message to connected browsers: everyone, or only organizer
	 * screens (`staff`). Messages never carry personal data.
	 */
	broadcast(message: string, tag?: 'staff'): number {
		const sockets = this.ctx.getWebSockets(tag)
		for (const socket of sockets) {
			try {
				socket.send(message)
			} catch {
				// A socket that closed between getWebSockets() and send() is fine to skip.
			}
		}
		return sockets.length
	}

	private async broadcastCheckIns(eventId: string) {
		if (this.ctx.getWebSockets('staff').length === 0) return
		const counts = await checkInCounts(this.db(), eventId)
		this.broadcast(JSON.stringify({ type: 'checkins', counts }), 'staff')
	}

	private async broadcastSeats(eventId: string) {
		if (this.ctx.getWebSockets().length === 0) return
		this.broadcast(JSON.stringify({ type: 'seats', seats: await seatCounts(this.db(), eventId) }))
	}

	/**
	 * Accepts a WebSocket. The caller (`web`) checks the event is public, or
	 * for `X-Live-Channel: staff` that the user is one of its organizers,
	 * before forwarding; this object has no public route.
	 */
	override async fetch(request: Request): Promise<Response> {
		if (request.headers.get('Upgrade') !== 'websocket') {
			return new Response('Expected a WebSocket upgrade', { status: 426 })
		}
		const { 0: client, 1: server } = new WebSocketPair()
		const staff = request.headers.get('X-Live-Channel') === 'staff'
		// Hibernatable: the object isn't billed while sockets sit idle.
		this.ctx.acceptWebSocket(server, staff ? ['staff'] : ['public'])
		return new Response(null, { status: 101, webSocket: client })
	}

	override async webSocketMessage(): Promise<void> {
		// Browsers only listen; anything they send is ignored.
	}

	override async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
		// 1005 ("no status") and 1006 ("abnormal") are reported, never sent: reply with a normal close.
		const reply = code === 1005 || code === 1006 ? 1000 : code
		try {
			socket.close(reply, reason)
		} catch {
			// Already closed.
		}
	}
}

// No public routes: other Workers reach the object through its binding.
export default {
	fetch: () => new Response('Not found', { status: 404, headers: apiSecurityHeaders }),
} satisfies ExportedHandler<Env>
