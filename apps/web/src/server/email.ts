import { env } from 'cloudflare:workers'

/** An email to send. Delivery goes through the jobs queue when deployed. */
export type OutgoingEmail = { to: string; subject: string; text: string }

export async function sendEmail(email: OutgoingEmail): Promise<void> {
	await sendEmails([email])
}

/** Many emails at once: queue batches of 100 (the Queues sendBatch limit), not one call each. */
export async function sendEmails(emails: readonly OutgoingEmail[]): Promise<void> {
	if (env.EMAIL_DELIVERY === 'console') {
		// Local dev only: emails contain sign-in links, so this must never run deployed.
		for (const email of emails) {
			console.log(`\n✉️  To: ${email.to}\nSubject: ${email.subject}\n\n${email.text}\n`)
		}
		return
	}
	for (let i = 0; i < emails.length; i += 100) {
		await env.JOBS.sendBatch(
			emails.slice(i, i + 100).map((email) => ({ body: { kind: 'email', ...email } })),
		)
	}
}
