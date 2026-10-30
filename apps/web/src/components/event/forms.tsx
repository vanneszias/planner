import { Button } from '@app/ui/components/button'
import { type FormEvent, useState } from 'react'
import { FormError } from '#/components/auth-shell'
import { Field, FieldInput } from '#/components/field'
import { m } from '#/paraglide/messages'
import { enterCodeFn, findProgrammeFn, registerFn } from '#/server/participant'
import { Turnstile } from './turnstile'

/** Registration (journeys.md, P1 step 2). From a session's Book button it books that session too. */
export function RegisterForm({
	eventId,
	sessionId,
	ageGroups,
	turnstileSiteKey,
	onDone,
	onCancel,
}: {
	eventId: string
	sessionId?: string
	ageGroups: { id: string; label: string }[]
	turnstileSiteKey: string | null
	onDone: (message: string, refusal?: string) => Promise<void>
	onCancel: () => void
}) {
	const [name, setName] = useState('')
	const [email, setEmail] = useState('')
	const [ageGroupId, setAgeGroupId] = useState(ageGroups[0]?.id ?? '')
	const [consent, setConsent] = useState(false)
	const [token, setToken] = useState<string>()
	const [issues, setIssues] = useState<Record<string, string>>({})
	const [error, setError] = useState<string | null>(null)
	const [pending, setPending] = useState(false)

	async function submit(event: FormEvent) {
		event.preventDefault()
		setError(null)
		const missing: Record<string, string> = {}
		if (!name.trim()) missing.name = 'required'
		if (!email.trim()) missing.email = 'required'
		if (!consent) missing.consent = 'required'
		if (Object.keys(missing).length) return setIssues(missing)
		setPending(true)
		const result = await registerFn({
			data: {
				eventId,
				sessionId,
				values: { name, email, ageGroupId: ageGroupId || undefined },
				turnstileToken: token,
			},
		})
		setPending(false)
		if (!result.ok) {
			if (result.reason === 'invalid') return setIssues(result.issues ?? {})
			return setError(m.refusal_bot())
		}
		if (result.existing) return onDone(m.register_existing())
		const booking = result.booking
		await onDone(m.registered_done(), booking && !booking.ok ? booking.reason : undefined)
	}

	return (
		<form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-xl bg-card p-5">
			<div>
				<h2 className="text-lg font-bold">{m.register_title()}</h2>
				<p className="text-sm text-muted-foreground">{m.register_intro()}</p>
			</div>
			<Field id="reg-name" label={m.name_label()} error={issues.name}>
				<FieldInput
					id="reg-name"
					autoComplete="name"
					error={issues.name}
					value={name}
					onChange={(e) => setName(e.target.value)}
					autoFocus
				/>
			</Field>
			<Field id="reg-email" label={m.email_label()} error={issues.email}>
				<FieldInput
					id="reg-email"
					type="email"
					autoComplete="email"
					error={issues.email}
					value={email}
					onChange={(e) => setEmail(e.target.value)}
				/>
			</Field>
			{ageGroups.length > 0 && (
				<Field id="reg-age" label={m.age_group_select()}>
					<select
						id="reg-age"
						className="h-11 rounded-md border border-input bg-card px-3"
						value={ageGroupId}
						onChange={(e) => setAgeGroupId(e.target.value)}
					>
						{ageGroups.map((group) => (
							<option key={group.id} value={group.id}>
								{group.label}
							</option>
						))}
					</select>
				</Field>
			)}
			<label className="flex cursor-pointer items-start gap-3">
				<input
					type="checkbox"
					className="mt-1 size-5 shrink-0 accent-[var(--kelp)]"
					checked={consent}
					aria-invalid={issues.consent ? true : undefined}
					onChange={(e) => setConsent(e.target.checked)}
				/>
				<span className="text-sm">{m.consent_label()}</span>
			</label>
			<Turnstile siteKey={turnstileSiteKey} onToken={setToken} />
			<FormError message={error ?? (issues.consent ? m.field_required() : null)} />
			<div className="flex flex-wrap gap-2">
				<Button type="submit" disabled={pending}>
					{sessionId ? m.register_and_book() : m.register_only()}
				</Button>
				<Button type="button" variant="ghost" onClick={onCancel}>
					{m.cancel()}
				</Button>
			</div>
		</form>
	)
}

/** "I have a code" (P3) and "Find my programme" (P4), folded away until needed. */
export function ReturningForms({
	eventId,
	turnstileSiteKey,
	onSignedIn,
}: {
	eventId: string
	turnstileSiteKey: string | null
	onSignedIn: () => Promise<void>
}) {
	const [code, setCode] = useState('')
	const [email, setEmail] = useState('')
	const [token, setToken] = useState<string>()
	const [codeError, setCodeError] = useState<string | null>(null)
	const [sent, setSent] = useState<string | null>(null)

	async function submitCode(event: FormEvent) {
		event.preventDefault()
		setCodeError(null)
		const result = await enterCodeFn({ data: { eventId, code, turnstileToken: token } })
		if (!result.ok) return setCodeError(m.code_wrong())
		await onSignedIn()
	}

	async function submitEmail(event: FormEvent) {
		event.preventDefault()
		await findProgrammeFn({ data: { eventId, email, turnstileToken: token } })
		setSent(m.find_programme_sent())
	}

	return (
		<div className="flex flex-col gap-3">
			<details className="rounded-xl bg-card p-4">
				<summary className="min-h-11 cursor-pointer content-center font-bold">
					{m.have_code()}
				</summary>
				<form onSubmit={submitCode} noValidate className="mt-3 flex flex-col gap-3">
					<Field id="code" label={m.code_label()}>
						<FieldInput
							id="code"
							autoComplete="off"
							autoCapitalize="characters"
							spellCheck={false}
							placeholder="K7Q2-XA"
							className="max-w-48 font-mono uppercase"
							value={code}
							onChange={(e) => setCode(e.target.value)}
						/>
					</Field>
					<FormError message={codeError} />
					<div>
						<Button type="submit" variant="outline">
							{m.code_submit()}
						</Button>
					</div>
				</form>
			</details>
			<details className="rounded-xl bg-card p-4">
				<summary className="min-h-11 cursor-pointer content-center font-bold">
					{m.find_programme()}
				</summary>
				<form onSubmit={submitEmail} noValidate className="mt-3 flex flex-col gap-3">
					<Field id="find-email" label={m.email_label()}>
						<FieldInput
							id="find-email"
							type="email"
							autoComplete="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
						/>
					</Field>
					<p aria-live="polite" className="text-sm font-bold empty:hidden">
						{sent}
					</p>
					<div>
						<Button type="submit" variant="outline">
							{m.find_submit()}
						</Button>
					</div>
				</form>
			</details>
			<Turnstile siteKey={turnstileSiteKey} onToken={setToken} />
		</div>
	)
}
