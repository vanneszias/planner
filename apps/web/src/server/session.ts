import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { getAuth } from './auth'

/** The signed-in organizer, or null. Used by route guards. */
export const getSessionUser = createServerFn({ method: 'GET' }).handler(async () => {
	const session = await getAuth().api.getSession({ headers: getRequestHeaders() })
	if (!session) return null
	return { id: session.user.id, name: session.user.name, email: session.user.email }
})

/** Whether the Google button should show: only when credentials are configured. */
export const getSignInOptions = createServerFn({ method: 'GET' }).handler(async () => ({
	google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
}))
