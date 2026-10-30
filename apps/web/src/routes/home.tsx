import { authClient } from '@app/auth/client'
import { Button } from '@app/ui/components/button'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { AuthShell } from '#/components/auth-shell'
import { m } from '#/paraglide/messages'
import { getSessionUser } from '#/server/session'

/** Placeholder organizer home until M1 adds events. */
export const Route = createFileRoute('/home')({
	beforeLoad: async () => {
		const user = await getSessionUser()
		if (!user) throw redirect({ to: '/sign-in' })
		return { user }
	},
	component: Home,
})

function Home() {
	const { user } = Route.useRouteContext()
	const navigate = useNavigate()
	const [status, setStatus] = useState<string | null>(null)

	async function addPasskey() {
		const result = await authClient.passkey.addPasskey()
		setStatus(result?.error ? m.error_passkey() : m.passkey_added())
	}

	async function signOut() {
		await authClient.signOut()
		await navigate({ to: '/sign-in' })
	}

	return (
		<AuthShell title={m.home_title({ name: user.name })} intro={m.home_body()}>
			<div className="flex flex-col gap-3">
				<Button variant="outline" onClick={addPasskey}>
					{m.add_passkey()}
				</Button>
				<p aria-live="polite" className="text-sm empty:hidden">
					{status}
				</p>
				<Button variant="ghost" onClick={signOut}>
					{m.sign_out()}
				</Button>
			</div>
		</AuthShell>
	)
}
