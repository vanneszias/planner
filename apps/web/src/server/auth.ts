import { env } from 'cloudflare:workers'
import { type Auth, type AuthEmail, createAuth } from '@app/auth'
import { createDb } from '@app/db'
import { createPersonalOrganization } from '@app/domain'

let auth: Auth | undefined

/** One Better Auth instance per isolate, created on first use. */
export function getAuth(): Auth {
	auth ??= createAuth({
		db: createDb(env.DB),
		baseURL: env.BETTER_AUTH_URL,
		secret: env.BETTER_AUTH_SECRET,
		sendEmail,
		google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
		onUserCreated: async (user) => {
			await createPersonalOrganization(createDb(env.DB), user)
		},
	})
	return auth
}

async function sendEmail(email: AuthEmail): Promise<void> {
	if (env.EMAIL_DELIVERY === 'console') {
		// Local dev only: emails contain sign-in links, so this must never run deployed.
		console.log(`\n✉️  To: ${email.to}\nSubject: ${email.subject}\n\n${email.text}\n`)
		return
	}
	await env.JOBS.send({ kind: 'email', ...email })
}
