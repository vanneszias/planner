import { authClient } from '@app/auth/client'
import { Button } from '@app/ui/components/button'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { AuthShell } from '#/components/auth-shell'
import { PassImage } from '#/components/event/pass-card'
import { m } from '#/paraglide/messages'
import { getAccountFn } from '#/server/account'

/** The participant account: every pass linked to the signed-in email (D29). */
export const Route = createFileRoute('/account')({
	loader: async () => {
		const account = await getAccountFn()
		if (!account) throw redirect({ href: `/sign-in?redirect=${encodeURIComponent('/account')}` })
		return account
	},
	component: Account,
})

function Account() {
	const account = Route.useLoaderData()
	const navigate = useNavigate()

	async function signOut() {
		await authClient.signOut()
		await navigate({ to: '/sign-in' })
	}

	return (
		<AuthShell title={m.account_title()} intro={m.account_signed_in_as({ email: account.email })}>
			{!account.verified && (
				<p className="mb-4 rounded-xl bg-tint-warning p-4 text-sm font-bold">
					{m.pass_confirm_email()}
				</p>
			)}

			<h2 className="mb-3 font-display text-lg font-semibold">{m.account_passes()}</h2>
			{account.passes.length === 0 ? (
				<p className="text-sm text-muted-foreground">{m.account_empty()}</p>
			) : (
				<ul className="flex flex-col gap-4">
					{account.passes.map((pass) => (
						<li
							key={pass.registrationId}
							className="flex items-center gap-4 rounded-xl bg-card p-4 shadow-card"
						>
							<PassImage pass={pass} className="size-28 shrink-0 rounded-lg bg-white p-1" />
							<div className="flex flex-col items-start gap-2">
								<p className="font-semibold">
									{pass.forChild ? m.pass_title_child({ name: pass.displayName }) : m.pass_title()}
								</p>
								<p className="text-sm text-muted-foreground">{pass.eventName}</p>
								<a
									href={pass.eventPath}
									className="text-sm font-bold text-primary underline underline-offset-4"
								>
									{m.account_open_event()}
								</a>
							</div>
						</li>
					))}
				</ul>
			)}

			<Button variant="ghost" className="mt-6 px-0" onClick={signOut}>
				{m.sign_out()}
			</Button>
		</AuthShell>
	)
}
