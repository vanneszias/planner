import { env } from 'cloudflare:workers'
import { createDb } from '@app/db'
import { pollByShareCode } from '@app/domain'
import { coordinatorFor } from '@app/platform'
import { createFileRoute } from '@tanstack/react-router'
import { clientIp, withinLimit } from '#/server/rate-limit'

/**
 * Live poll updates: forwards a WebSocket upgrade to the poll's Durable
 * Object. Anyone with the share link may listen. Messages only say "something
 * changed" (never names or availability); browsers then refetch the page.
 */
export const Route = createFileRoute('/api/live/poll/$code')({
	server: {
		handlers: {
			GET: async ({ params, request }) => {
				if (request.headers.get('Upgrade') !== 'websocket') {
					return new Response('Expected a WebSocket upgrade', { status: 426 })
				}
				const poll = await pollByShareCode(createDb(env.DB), params.code)
				if (!poll) return new Response('Not found', { status: 404 })
				if (!(await withinLimit('live', `${clientIp()}:${poll.id}`))) {
					return new Response('Too many connections', { status: 429 })
				}
				// Public channel only: strip any staff header a client might send.
				const headers = new Headers(request.headers)
				headers.delete('X-Live-Channel')
				return coordinatorFor(env.EVENT_COORDINATOR, env.COORDINATOR_JURISDICTION, poll.id).fetch(
					new Request(request, { headers }),
				)
			},
		},
	},
})
