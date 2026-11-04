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
import { LogOut } from 'lucide-react'
import { BrandMark } from '#/components/brand-mark'
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
	'flex h-9 shrink-0 items-center rounded-md px-2 text-sm sm:px-2.5 font-bold whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground data-[status=active]:bg-accent data-[status=active]:text-foreground'

function OrganizerLayout() {
	const { organizations, activeId, canAudit } = Route.useLoaderData()
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
			<header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur print:hidden">
				<div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4 sm:gap-6">
					<Link to="/home" className="flex items-center gap-2 font-display text-base font-semibold">
						<BrandMark />
						<span className="max-sm:sr-only">{brand.name}</span>
					</Link>
					<nav
						aria-label={brand.name}
						className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
					>
						<Link to="/home" className={navLink}>
							{m.nav_events()}
						</Link>
						<Link to="/team" className={navLink}>
							{m.nav_team()}
						</Link>
						{canAudit && (
							<Link to="/audit" className={navLink}>
								{m.nav_audit()}
							</Link>
						)}
					</nav>
					{organizations.length > 1 && (
						<label className="flex items-center gap-2 text-sm text-muted-foreground">
							<span className="sr-only">{m.switch_organization()}</span>
							<select
								className="h-9 max-w-40 rounded-md border border-input bg-card px-2 text-sm font-bold text-foreground"
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
					)}
					<LanguageSwitch compact />
					<Button
						variant="ghost"
						size="sm"
						className="h-9 text-sm font-bold text-muted-foreground hover:text-foreground"
						onClick={signOut}
						aria-label={m.sign_out()}
					>
						<LogOut />
						<span className="max-sm:hidden">{m.sign_out()}</span>
					</Button>
				</div>
			</header>
			<main className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
				<Outlet />
			</main>
		</div>
	)
}
