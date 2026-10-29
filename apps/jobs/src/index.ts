/**
 * Background work: queue consumers (email, exports) and scheduled tasks
 * (retention cleanup). Handlers must be idempotent: queues deliver at least once.
 */

/** Placeholder until the message types move to packages/domain. */
type JobMessage = { kind: 'email'; to: string; subject: string; text: string } | { kind: string }

export default {
	async queue(batch) {
		for (const message of batch.messages) {
			if (message.body.kind === 'email') {
				// Sending lands with the Email Service setup (needs a sending domain).
				// Never log the body: it contains sign-in links.
				console.warn('Email not sent: no sending domain configured yet', { id: message.id })
			} else {
				console.warn('Unhandled job', { kind: message.body.kind, id: message.id })
			}
			message.ack()
		}
	},

	async scheduled() {
		// Retention cleanup lands in M5.
	},
} satisfies ExportedHandler<Env, JobMessage>
