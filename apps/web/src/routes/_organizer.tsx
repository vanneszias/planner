import { authClient } from '@app/auth/client'
import { brand } from '@app/brand'
import { Button } from '@app/ui/components/button'
import {
	createFileRoute,
	Link,
	Outlet,
	redirect,
	useNavigate,
	useRouter,
} from '@tanstack/react-router'
import { LanguageSwitch } from '#/components/language-switch'
import { m } from '#/paraglide/messages'
import { getMyOrganizations } from '#/server/people'
import { getSessionUser } from '#/server/session'

/** Every organizer page: signed-in only, shared header. */
export const Route = createFileRoute('/_organizer')({
	beforeLoad: async ({ location }) => {
		const user = await getSessionUser()
		if (!user) throw redirect({ to: '/sign-in', search: { redirect: location.href } })
		return { user }
	},
	loader: () => getMyOrganizations(),
	component: OrganizerLayout,
})

const navLink =
	'text-sm font-bold text-muted-foreground hover:text-foreground data-[status=active]:text-foreground data-[status=active]:underline data-[status=active]:underline-offset-4'

function OrganizerLayout() {
	const { organizations, activeId } = Route.useLoaderData()
	const navigate = useNavigate()
	const router = useRouter()

	async function signOut() {
		await authClient.signOut()
		await navigate({ to: '/sign-in' })
	}

	async function switchOrganization(organizationId: string) {
		await authClient.organization.setActive({ organizationId })
		await navigate({ to: '/home' })
		await router.invalidate()
	}

	return (
		<div className="min-h-dvh">
			<header className="border-b border-border bg-card">
				{/* Row 1: where you can go. Row 2: context (organization, language). */}
				<div className="mx-auto flex max-w-4xl items-center gap-3 px-4 pt-2">
					<Link to="/home" className="font-display text-base font-semibold">
						{brand.name}
					</Link>
					<nav aria-label={brand.name} className="flex flex-1 gap-3">
						<Link to="/home" className={navLink}>
							{m.nav_events()}
						</Link>
						<Link to="/team" className={navLink}>
							{m.nav_team()}
						</Link>
					</nav>
					<Button variant="ghost" className="px-2" onClick={signOut}>
						{m.sign_out()}
					</Button>
				</div>
				<div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4 pb-2">
					{organizations.length > 1 ? (
						<label className="flex items-center gap-2 text-sm text-muted-foreground">
							{m.switch_organization()}
							<select
								className="min-h-11 max-w-48 rounded-md border border-input bg-card px-2 text-foreground"
								value={activeId}
								onChange={(event) => switchOrganization(event.target.value)}
							>
								{organizations.map((organization) => (
									<option key={organization.id} value={organization.id}>
										{organization.name}
									</option>
								))}
							</select>
						</label>
					) : (
						<span />
					)}
					<LanguageSwitch />
				</div>
			</header>
			<main className="mx-auto max-w-4xl px-4 py-8">
				<Outlet />
			</main>
		</div>
	)
}
