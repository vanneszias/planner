import { createDb } from '@app/db'
import { exportFile, verifyExportLink } from '@app/domain'
import { apiSecurityHeaders, withHeaders } from '@app/platform'

/**
 * External endpoints only: calendar feeds, export downloads, and later the
 * public API (docs/decisions.md, A2). The web app never calls this Worker.
 */
export default {
	async fetch(request, env) {
		return withHeaders(await route(request, env), apiSecurityHeaders)
	},
} satisfies ExportedHandler<Env>

async function route(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url)
	if (url.pathname === '/health') return Response.json({ ok: true })

	const download = url.pathname.match(/^\/exports\/([\w-]{1,64})$/)
	if (download?.[1] && request.method === 'GET') return exportDownload(env, url, download[1])

	return new Response('Not found', { status: 404 })
}

/**
 * A CSV export through the 15-minute link `web` signed after checking the
 * organizer (security-privacy.md, "api Worker"). Anything off is a plain 404.
 */
async function exportDownload(env: Env, url: URL, exportId: string): Promise<Response> {
	const expires = Number(url.searchParams.get('expires'))
	const signature = url.searchParams.get('signature') ?? ''
	const gone = () =>
		new Response('This download link has expired. Ask for a new one from the event.', {
			status: 404,
			headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
		})
	if (!(await verifyExportLink(env.EXPORT_SIGNING_KEY, exportId, expires, signature))) return gone()
	const file = await exportFile(createDb(env.DB), exportId)
	const object = file && (await env.FILES.get(file.r2Key))
	if (!file || !object) return gone()
	return new Response(object.body, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${file.filename}"`,
			'Cache-Control': 'private, no-store',
		},
	})
}
