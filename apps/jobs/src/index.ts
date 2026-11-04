import { brand } from '@app/brand'
import { createDb, type Db } from '@app/db'
import {
	deleteExpiredPolls,
	type ExportMessage,
	expireExports,
	failExport,
	pollById,
	pollOutcomeEmails,
	resolveDuePolls,
	runExport,
	runRetention,
} from '@app/domain'
import { r2Files } from '@app/platform'

/**
 * Background work: queue consumers (email, exports) and scheduled tasks
 * (retention cleanup). Handlers must be idempotent: queues deliver at least once.
 */

type EmailMessage = { kind: 'email'; to: string; subject: string; text: string }
type JobMessage = EmailMessage | ExportMessage | { kind: string }

/** Matches max_retries in wrangler.jsonc: the last attempt marks an export failed. */
const maxAttempts = 6

export default {
	async queue(batch, env) {
		const db = createDb(env.DB)
		const files = r2Files(env.FILES)
		for (const message of batch.messages) {
			const body = message.body
			if (body.kind === 'email') {
				// Sending lands with the Email Service setup (needs a sending domain).
				// Never log the body: it contains sign-in links.
				console.warn('Email not sent: no sending domain configured yet', { id: message.id })
			} else if (body.kind === 'export' && 'exportId' in body) {
				try {
					await runExport(db, files, body.exportId)
				} catch (error) {
					console.error('Export failed', { exportId: body.exportId, error: String(error) })
					if (message.attempts >= maxAttempts) await failExport(db, body.exportId)
					else {
						message.retry({ delaySeconds: 10 * message.attempts })
						continue
					}
				}
			} else {
				console.warn('Unhandled job', { kind: body.kind, id: message.id })
			}
			message.ack()
		}
	},

	/**
	 * Every 15 minutes: decide auto polls past their deadline. Daily: anonymise
	 * events past their retention date, delete old polls and expired exports.
	 */
	async scheduled(controller, env) {
		const db = createDb(env.DB)
		if (controller.cron === '*/15 * * * *') {
			await decidePolls(db, env)
			return
		}
		const files = r2Files(env.FILES)
		const retention = await runRetention(db, files)
		const expired = await expireExports(db, files)
		const deletedPolls = await deleteExpiredPolls(db)
		// IDs and counts only (security-privacy.md, "Logs").
		console.log('Retention run', { ...retention, expiredExports: expired, deletedPolls })
		if (retention.failed.length > 0) throw new Error('Some events could not be anonymised')
	},
} satisfies ExportedHandler<Env, JobMessage>

/** Confirms or flags due auto polls, then queues the outcome emails (claimed, so sent once). */
async function decidePolls(db: Db, env: Env) {
	const resolved = await resolveDuePolls(db)
	for (const { pollId } of resolved) {
		const poll = await pollById(db, pollId)
		if (!poll) continue
		const emails = await pollOutcomeEmails(db, poll, { url: env.APP_URL, name: brand.name })
		for (let i = 0; i < emails.length; i += 100) {
			await env.JOBS.sendBatch(
				emails.slice(i, i + 100).map((email) => ({ body: { kind: 'email', ...email } })),
			)
		}
	}
	if (resolved.length > 0) {
		console.log('Polls decided', {
			confirmed: resolved.filter((r) => r.outcome === 'confirmed').map((r) => r.pollId),
			needsDecision: resolved.filter((r) => r.outcome === 'needs_decision').map((r) => r.pollId),
		})
	}
}
