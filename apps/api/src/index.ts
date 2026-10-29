/**
 * External endpoints only: calendar feeds, export downloads, and later the
 * public API (docs/decisions.md, A2). The web app never calls this Worker.
 */
export default {
	async fetch(request) {
		const { pathname } = new URL(request.url)
		if (pathname === '/health') return Response.json({ ok: true })
		return new Response('Not found', { status: 404 })
	},
} satisfies ExportedHandler<Env>
