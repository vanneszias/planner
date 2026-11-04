import { env } from 'cloudflare:workers'
import { createDb, schema } from '@app/db'
import { respondentFromToken } from '@app/domain'
import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { setRespondentCookie } from '#/server/poll-session'

/**
 * A guest's private edit link: swapped for a cookie at once, then on to the
 * poll, so the token doesn't linger in history or Referer headers.
 */
export const Route = createFileRoute('/m/r/$token')({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const db = createDb(env.DB)
				const respondent = await respondentFromToken(db, params.token)
				const [poll] = respondent
					? await db
							.select({ shareCode: schema.poll.shareCode })
							.from(schema.poll)
							.where(eq(schema.poll.id, respondent.pollId))
							.limit(1)
					: []
				if (!respondent || !poll) {
					return new Response('This link no longer works. Open the poll link and answer again.', {
						status: 404,
						headers: {
							'Content-Type': 'text/plain; charset=utf-8',
							'Referrer-Policy': 'no-referrer',
						},
					})
				}
				await setRespondentCookie(db, respondent.pollId, respondent.id)
				return new Response(null, {
					status: 303,
					headers: {
						Location: `/m/${poll.shareCode}`,
						'Referrer-Policy': 'no-referrer',
						'Cache-Control': 'no-store',
					},
				})
			},
		},
	},
})
