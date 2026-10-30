import { env } from 'cloudflare:workers'
import { type Auth, createAuth } from '@app/auth'
import { createDb } from '@app/db'
import { createPersonalOrganization, reservedSlugs } from '@app/domain'
import { sendEmail } from './email'

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
		isReservedSlug: (slug) => reservedSlugs.has(slug),
	})
	return auth
}
