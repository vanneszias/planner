/**
 * Workers that bind to the coordinator's Durable Object (`script_name:
 * "event-coordinator"`) fail to start in tests unless that Worker exists.
 * This stub stands in for it; the real object is tested in apps/coordinator.
 */
export const coordinatorStubWorker = {
	name: 'event-coordinator',
	modules: [
		{
			type: 'ESModule' as const,
			path: 'index.mjs',
			contents: `
import { DurableObject } from 'cloudflare:workers'
export class EventCoordinator extends DurableObject {
	async ping() { return 'pong' }
}
export default { fetch: () => new Response('Not found', { status: 404 }) }
`,
		},
	],
	compatibilityDate: '2026-10-23',
	durableObjects: {
		EVENT_COORDINATOR: { className: 'EventCoordinator', useSQLite: true },
	},
}
