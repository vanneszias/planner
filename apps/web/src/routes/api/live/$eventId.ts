import { env } from 'cloudflare:workers'
import { createDb, schema } from '@app/db'
import { can, organizerContext, publicEventMeta } from '@app/domain'
import { coordinatorFor } from '@app/platform'
import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { getAuth } from '#/server/auth'
import { clientIp, withinLimit } from '#/server/rate-limit'

/**
 * Live updates (A5): forwards a WebSocket upgrade to the event's Durable
 * Object. Seat counts are public, so any visitor of a published event may
 * listen. `?staff=1` adds check-in counts, for the event's organizers only.
 * Messages never carry personal data.
 */
export const Route = createFileRoute('/api/live/$eventId')({
	server: {
		handlers: {
			GET: async ({ params, request }) => {
				if (request.headers.get('Upgrade') !== 'websocket') {
					return new Response('Expected a WebSocket upgrade', { status: 426 })
				}
				if (!(await withinLimit('live', `${clientIp()}:${params.eventId}`))) {
					return new Response('Too many connections', { status: 429 })
				}
				const db = createDb(env.DB)
				const forward = (eventId: string, staff: boolean) => {
					const headers = new Headers(request.headers)
					headers.delete('X-Live-Channel')
					if (staff) headers.set('X-Live-Channel', 'staff')
					return coordinatorFor(env.EVENT_COORDINATOR, env.COORDINATOR_JURISDICTION, eventId).fetch(
						new Request(request, { headers }),
					)
				}

				if (new URL(request.url).searchParams.get('staff') === '1') {
					const session = await getAuth().api.getSession({ headers: request.headers })
					const [event] = await db
						.select({ id: schema.event.id, organizationId: schema.event.organizationId })
						.from(schema.event)
						.where(eq(schema.event.id, params.eventId))
						.limit(1)
					const ctx =
						session && event
							? await organizerContext(db, session.user.id, event.organizationId)
							: null
					if (!event || !ctx || !can(ctx, { participant: ['read'] })) {
						return new Response('Not found', { status: 404 })
					}
					return forward(event.id, true)
				}

				const meta = await publicEventMeta(db, params.eventId)
				if (!meta) return new Response('Not found', { status: 404 })
				return forward(meta.id, false)
			},
		},
	},
})
