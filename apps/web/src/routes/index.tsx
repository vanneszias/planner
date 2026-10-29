import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionUser } from '#/server/session'

// No public landing page yet: send organizers where they need to be.
export const Route = createFileRoute('/')({
	beforeLoad: async () => {
		const user = await getSessionUser()
		throw redirect({ to: user ? '/home' : '/sign-in' })
	},
})
