import { env } from 'cloudflare:workers'
import { createDb } from '@app/db'
import { publicEventMeta } from '@app/domain'
import { coordinatorFor } from '@app/platform'
import { createFileRoute } from '@tanstack/react-router'

/**
 * Live seat counts (A5): forwards a WebSocket upgrade to the event's Durable
 * Object. Seat counts are public information, so any visitor of a published
 * event may listen; messages never carry personal data.
 */
export const Route = createFileRoute('/api/live/$eventId')({
	server: {
		handlers: {
			GET: async ({ params, request }) => {
				if (request.headers.get('Upgrade') !== 'websocket') {
					return new Response('Expected a WebSocket upgrade', { status: 426 })
				}
				const meta = await publicEventMeta(createDb(env.DB), params.eventId)
				if (!meta) return new Response('Not found', { status: 404 })
				return coordinatorFor(env.EVENT_COORDINATOR, env.COORDINATOR_JURISDICTION, meta.id).fetch(
					request,
				)
			},
		},
	},
})
