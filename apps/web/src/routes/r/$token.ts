import { env } from 'cloudflare:workers'
import { createDb } from '@app/db'
import { contextFromToken, publicEventMeta } from '@app/domain'
import { createFileRoute } from '@tanstack/react-router'
import { setParticipantCookie } from '#/server/participant-session'

/**
 * Private link landing (D16, security-privacy.md): the token is swapped for a
 * cookie at once and the browser is sent to the clean event URL, so the token
 * doesn't linger in history, screenshots or Referer headers.
 * `?then=cancel` comes from "Not you? Cancel this registration" (D23).
 */
export const Route = createFileRoute('/r/$token')({
	server: {
		handlers: {
			GET: async ({ params, request }) => {
				const db = createDb(env.DB)
				const context = await contextFromToken(db, params.token)
				const meta = context ? await publicEventMeta(db, context.eventId) : null
				if (!context || !meta) {
					return new Response('This link no longer works. Ask for a new one on the event page.', {
						status: 404,
						headers: {
							'Content-Type': 'text/plain; charset=utf-8',
							'Referrer-Policy': 'no-referrer',
						},
					})
				}
				await setParticipantCookie(context)
				const then = new URL(request.url).searchParams.get('then') === 'cancel' ? '?cancel=1' : ''
				return new Response(null, {
					status: 303,
					headers: {
						Location: `/${meta.organizationSlug}/${meta.slug}${then}`,
						'Referrer-Policy': 'no-referrer',
						'Cache-Control': 'no-store',
					},
				})
			},
		},
	},
})
