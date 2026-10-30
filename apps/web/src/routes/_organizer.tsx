import { authClient } from '@app/auth/client'
import { brand } from '@app/brand'
import { Button } from '@app/ui/components/button'
import { createFileRoute, Link, Outlet, redirect, useNavigate } from '@tanstack/react-router'
import { LanguageSwitch } from '#/components/language-switch'
import { m } from '#/paraglide/messages'
import { getSessionUser } from '#/server/session'

/** Every organizer page: signed-in only, shared header. */
export const Route = createFileRoute('/_organizer')({
	beforeLoad: async () => {
		const user = await getSessionUser()
		if (!user) throw redirect({ to: '/sign-in' })
		return { user }
	},
	component: OrganizerLayout,
})

function OrganizerLayout() {
	const navigate = useNavigate()

	async function signOut() {
		await authClient.signOut()
		await navigate({ to: '/sign-in' })
	}

	return (
		<div className="min-h-dvh">
			<header className="border-b border-border bg-card">
				<div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-2">
					<Link to="/home" className="font-display text-base font-semibold">
						{brand.name}
					</Link>
					<nav aria-label={m.nav_events()} className="flex-1">
						<Link
							to="/home"
							className="text-sm font-bold text-muted-foreground hover:text-foreground data-[status=active]:text-foreground data-[status=active]:underline data-[status=active]:underline-offset-4"
						>
							{m.nav_events()}
						</Link>
					</nav>
					<LanguageSwitch />
					<Button variant="ghost" className="px-2" onClick={signOut}>
						{m.sign_out()}
					</Button>
				</div>
			</header>
			<main className="mx-auto max-w-4xl px-4 py-8">
				<Outlet />
			</main>
		</div>
	)
}
