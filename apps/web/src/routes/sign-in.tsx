import { authClient } from '@app/auth/client'
import { Button } from '@app/ui/components/button'
import { Input } from '@app/ui/components/input'
import { Label } from '@app/ui/components/label'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { AuthShell, FormError } from '#/components/auth-shell'
import { Turnstile } from '#/components/event/turnstile'
import { authErrorMessage } from '#/lib/auth-errors'
import { safeRedirect } from '#/lib/redirect'
import { m } from '#/paraglide/messages'
import { getSessionUser, getSignInOptions } from '#/server/session'

export const Route = createFileRoute('/sign-in')({
	validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
		redirect: safeRedirect(search.redirect),
	}),
	beforeLoad: async ({ search }) => {
		if (await getSessionUser()) throw redirect({ href: search.redirect ?? '/home' })
	},
	loader: () => getSignInOptions(),
	component: SignIn,
})

function SignIn() {
	const options = Route.useLoaderData()
	const navigate = useNavigate()
	const { redirect: next = '/home' } = Route.useSearch()
	const [mode, setMode] = useState<'link' | 'password'>('link')
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [sentTo, setSentTo] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [pending, setPending] = useState(false)
	const [captcha, setCaptcha] = useState<string>()
	const [attempt, setAttempt] = useState(0)

	async function submit(event: FormEvent) {
		event.preventDefault()
		setError(null)
		setPending(true)
		// Magic link requests carry a Turnstile token (security-privacy.md); it works once.
		const result =
			mode === 'link'
				? await authClient.signIn.magicLink(
						{ email, callbackURL: next },
						{ headers: captcha ? { 'x-captcha-response': captcha } : {} },
					)
				: await authClient.signIn.email({ email, password })
		setPending(false)
		if (mode === 'link') setAttempt((n) => n + 1)
		if (result.error) return setError(authErrorMessage(result.error))
		if (mode === 'link') setSentTo(email)
		else await navigate({ href: next })
	}

	async function signInWithPasskey() {
		setError(null)
		const result = await authClient.signIn.passkey()
		if (result?.error) return setError(m.error_passkey())
		await navigate({ href: next })
	}

	if (sentTo) {
		return (
			<AuthShell title={m.link_sent_title()}>
				<p aria-live="polite">{m.link_sent_body({ email: sentTo })}</p>
				<Button variant="link" className="mt-4 px-0" onClick={() => setSentTo(null)}>
					{m.link_sent_again()}
				</Button>
			</AuthShell>
		)
	}

	return (
		<AuthShell
			title={m.sign_in_title()}
			intro={m.sign_in_intro()}
			footer={
				<p className="text-sm">
					{m.no_account()}{' '}
					<Link
						to="/sign-up"
						search={{ redirect: next === '/home' ? undefined : next }}
						className="font-bold text-primary underline underline-offset-4"
					>
						{m.create_account_link()}
					</Link>
				</p>
			}
		>
			<form onSubmit={submit} className="flex flex-col gap-4" noValidate>
				<div className="flex flex-col gap-2">
					<Label htmlFor="email">{m.email_label()}</Label>
					<Input
						id="email"
						type="email"
						autoComplete="username webauthn"
						required
						value={email}
						onChange={(event) => setEmail(event.target.value)}
					/>
				</div>
				{mode === 'password' && (
					<div className="flex flex-col gap-2">
						<Label htmlFor="password">{m.password_label()}</Label>
						<Input
							id="password"
							type="password"
							autoComplete="current-password"
							required
							value={password}
							onChange={(event) => setPassword(event.target.value)}
						/>
					</div>
				)}
				{mode === 'link' && (
					<Turnstile siteKey={options.turnstileSiteKey} onToken={setCaptcha} resetKey={attempt} />
				)}
				<FormError message={error} />
				<Button type="submit" disabled={pending}>
					{mode === 'link' ? m.send_link() : m.sign_in_with_password()}
				</Button>
				<Button
					type="button"
					variant="link"
					className="self-start px-0"
					onClick={() => setMode(mode === 'link' ? 'password' : 'link')}
				>
					{mode === 'link' ? m.use_password() : m.use_link()}
				</Button>
			</form>

			<div className="my-5 flex items-center gap-3 text-sm text-muted-foreground">
				<span className="h-px flex-1 bg-border" />
				{m.or()}
				<span className="h-px flex-1 bg-border" />
			</div>

			<div className="flex flex-col gap-3">
				<Button type="button" variant="outline" onClick={signInWithPasskey}>
					{m.sign_in_with_passkey()}
				</Button>
				{options.google && (
					<Button
						type="button"
						variant="outline"
						onClick={() => authClient.signIn.social({ provider: 'google', callbackURL: next })}
					>
						{m.sign_in_with_google()}
					</Button>
				)}
			</div>
		</AuthShell>
	)
}
