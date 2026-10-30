import { env } from 'cloudflare:workers'
import { coordinatorFor } from '@app/platform'
import { createFileRoute } from '@tanstack/react-router'

/** Smoke test for deploys: checks D1 and the coordinator Durable Object. */
export const Route = createFileRoute('/health')({
	server: {
		handlers: {
			GET: async () => {
				const db = await env.DB.prepare('select 1 as ok')
					.first<{ ok: number }>()
					.then((row) => row?.ok === 1)
					.catch(() => false)

				const coordinator = await coordinatorFor(
					env.EVENT_COORDINATOR,
					env.COORDINATOR_JURISDICTION,
					'health',
				)
					.ping()
					.then((reply) => reply === 'pong')
					.catch(() => false)

				const ok = db && coordinator
				return Response.json({ ok, db, coordinator }, { status: ok ? 200 : 503 })
			},
		},
	},
})
