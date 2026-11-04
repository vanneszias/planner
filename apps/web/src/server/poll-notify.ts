import { env } from 'cloudflare:workers'
import { brand } from '@app/brand'
import type { Db } from '@app/db'
import { type Poll, pollOutcomeEmails } from '@app/domain'
import { coordinatorFor } from '@app/platform'
import { sendEmails } from './email'

/* Server-only helpers shared by the organizer and public poll server functions. */

export const pollLink = (poll: Pick<Poll, 'shareCode'>) =>
	`${env.BETTER_AUTH_URL}/m/${poll.shareCode}`

/**
 * Tells browsers on the poll page to refetch. The per-id Durable Object is
 * the same class events use; poll ids are UUIDv7 too, so they never collide.
 * A failed broadcast only means someone's heatmap updates on their next load.
 */
export async function notifyPoll(pollId: string): Promise<void> {
	try {
		await coordinatorFor(env.EVENT_COORDINATOR, env.COORDINATOR_JURISDICTION, pollId).broadcast(
			JSON.stringify({ type: 'poll' }),
		)
	} catch (error) {
		console.warn('Poll broadcast failed', { pollId, error: String(error) })
	}
}

/** Mails the outcome (confirmed time, or "please decide") to whoever hasn't had it yet. */
export async function sendPollOutcome(db: Db, poll: Poll): Promise<void> {
	await sendEmails(
		await pollOutcomeEmails(db, poll, { url: env.BETTER_AUTH_URL, name: brand.name }),
	)
}
