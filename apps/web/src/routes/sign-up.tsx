import { authClient } from '@app/auth/client'
import { Button } from '@app/ui/components/button'
import { Input } from '@app/ui/components/input'
import { Label } from '@app/ui/components/label'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { AuthShell, FormError } from '#/components/auth-shell'
import { authErrorMessage } from '#/lib/auth-errors'
import { m } from '#/paraglide/messages'
import { getSessionUser } from '#/server/session'

export const Route = createFileRoute('/sign-up')({
	beforeLoad: async () => {
		if (await getSessionUser()) throw redirect({ to: '/home' })
	},
	component: SignUp,
})

function SignUp() {
	const navigate = useNavigate()
	const [name, setName] = useState('')
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [pending, setPending] = useState(false)

	async function submit(event: FormEvent) {
		event.preventDefault()
		setError(null)
		setPending(true)
		const result = await authClient.signUp.email({ name, email, password })
		setPending(false)
		if (result.error) return setError(authErrorMessage(result.error))
		await navigate({ to: '/home' })
	}

	return (
		<AuthShell
			title={m.sign_up_title()}
			intro={m.sign_up_intro()}
			footer={
				<p className="text-sm">
					{m.have_account()}{' '}
					<Link to="/sign-in" className="font-bold text-primary underline underline-offset-4">
						{m.sign_in_link()}
					</Link>
				</p>
			}
		>
			<form onSubmit={submit} className="flex flex-col gap-4" noValidate>
				<div className="flex flex-col gap-2">
					<Label htmlFor="name">{m.name_label()}</Label>
					<Input
						id="name"
						autoComplete="name"
						required
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor="email">{m.email_label()}</Label>
					<Input
						id="email"
						type="email"
						autoComplete="email"
						required
						value={email}
						onChange={(event) => setEmail(event.target.value)}
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor="password">{m.password_label()}</Label>
					<Input
						id="password"
						type="password"
						autoComplete="new-password"
						minLength={10}
						aria-describedby="password-hint"
						required
						value={password}
						onChange={(event) => setPassword(event.target.value)}
					/>
					<p id="password-hint" className="text-sm text-muted-foreground">
						{m.password_hint()}
					</p>
				</div>
				<FormError message={error} />
				<Button type="submit" disabled={pending}>
					{m.sign_up_submit()}
				</Button>
			</form>
		</AuthShell>
	)
}
