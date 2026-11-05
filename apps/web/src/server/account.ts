import { createServerFn } from '@tanstack/react-start'
import { accountPasses, signedInUser } from './account-passes'

/*
 * The account page's data. Sign-in itself is the normal one (magic link,
 * passkey, password, Google); see server/account-passes.ts for the rest.
 */

/** The account page: the signed-in person's email, verification state and passes. Null when signed out. */
export const getAccountFn = createServerFn({ method: 'GET' }).handler(async () => {
	const user = await signedInUser()
	if (!user) return null
	return {
		email: user.email,
		verified: user.emailVerified,
		passes: await accountPasses(user),
	}
})
