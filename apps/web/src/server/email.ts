import { env } from 'cloudflare:workers'

/** An email to send. Delivery goes through the jobs queue when deployed. */
export type OutgoingEmail = { to: string; subject: string; text: string }

export async function sendEmail(email: OutgoingEmail): Promise<void> {
	if (env.EMAIL_DELIVERY === 'console') {
		// Local dev only: emails contain sign-in links, so this must never run deployed.
		console.log(`\n✉️  To: ${email.to}\nSubject: ${email.subject}\n\n${email.text}\n`)
		return
	}
	await env.JOBS.send({ kind: 'email', ...email })
}
