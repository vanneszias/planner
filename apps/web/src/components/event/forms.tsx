import { Button } from '@app/ui/components/button'
import { ChevronDown, KeyRound, Mail } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { FormError } from '#/components/auth-shell'
import { Field, FieldInput, FieldSelect, FormActions } from '#/components/field'
import { m } from '#/paraglide/messages'
import { enterCodeFn, findProgrammeFn, registerFn } from '#/server/participant'
import { Turnstile } from './turnstile'

/** Registration (journeys.md, P1 step 2). From a session's Book button it books that session too. */
export function RegisterForm({
	eventId,
	sessionId,
	ageGroups,
	suggestedAgeGroups = [],
	turnstileSiteKey,
	onDone,
	onCancel,
}: {
	eventId: string
	sessionId?: string
	ageGroups: { id: string; label: string }[]
	/** Labels of the age groups the clicked session is for: preselect the first match. */
	suggestedAgeGroups?: string[]
	turnstileSiteKey: string | null
	onDone: (message: string, refusal?: string) => Promise<void>
	onCancel: () => void
}) {
	const [name, setName] = useState('')
	const [email, setEmail] = useState('')
	const [ageGroupId, setAgeGroupId] = useState(
		(ageGroups.find((g) => suggestedAgeGroups.includes(g.label)) ?? ageGroups[0])?.id ?? '',
	)
	const [consent, setConsent] = useState(false)
	const [token, setToken] = useState<string>()
	const [attempt, setAttempt] = useState(0)
	const [issues, setIssues] = useState<Record<string, string>>({})
	const [error, setError] = useState<string | null>(null)
	const [pending, setPending] = useState(false)

	/** Shows field problems and moves focus to the first, so it's announced with its error. */
	function showIssues(found: Record<string, string>) {
		setIssues(found)
		const first = ['name', 'email', 'consent'].find((field) => found[field])
		if (first) requestAnimationFrame(() => document.getElementById(`reg-${first}`)?.focus())
	}

	async function submit(event: FormEvent) {
		event.preventDefault()
		setError(null)
		const missing: Record<string, string> = {}
		if (!name.trim()) missing.name = 'required'
		if (!email.trim()) missing.email = 'required'
		if (!consent) missing.consent = 'required'
		if (Object.keys(missing).length) return showIssues(missing)
		if (pending) return
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
		// Turnstile tokens work once.
		setAttempt((n) => n + 1)
		if (!result.ok) {
			if (result.reason === 'invalid') return showIssues(result.issues ?? {})
			return setError(result.reason === 'busy' ? m.refusal_busy() : m.refusal_bot())
		}
		if (result.existing) return onDone(m.register_existing())
		const booking = result.booking
		await onDone(m.registered_done(), booking && !booking.ok ? booking.reason : undefined)
	}

	return (
		<form onSubmit={submit} noValidate className="flex flex-col gap-5">
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
					<FieldSelect
						id="reg-age"
						value={ageGroupId}
						onChange={(e) => setAgeGroupId(e.target.value)}
					>
						{ageGroups.map((group) => (
							<option key={group.id} value={group.id}>
								{group.label}
							</option>
						))}
					</FieldSelect>
				</Field>
			)}
			<label className="flex cursor-pointer items-start gap-3">
				<input
					id="reg-consent"
					type="checkbox"
					className="mt-1 size-5 shrink-0 accent-[var(--kelp)]"
					checked={consent}
					aria-invalid={issues.consent ? true : undefined}
					aria-describedby={issues.consent ? 'reg-consent-error' : undefined}
					onChange={(e) => setConsent(e.target.checked)}
				/>
				<span className="text-sm">{m.consent_label()}</span>
			</label>
			{issues.consent && (
				<p id="reg-consent-error" className="-mt-2 text-sm font-bold text-destructive">
					{m.consent_required()}
				</p>
			)}
			<Turnstile siteKey={turnstileSiteKey} onToken={setToken} resetKey={attempt} />
			<FormError message={error} />
			<FormActions>
				<Button type="button" variant="outline" onClick={onCancel}>
					{m.cancel()}
				</Button>
				<Button type="submit" aria-disabled={pending || undefined}>
					{sessionId ? m.register_and_book() : m.register_only()}
				</Button>
			</FormActions>
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
	const [attempt, setAttempt] = useState(0)
	const [codeError, setCodeError] = useState<string | null>(null)
	const [sent, setSent] = useState<string | null>(null)

	async function submitCode(event: FormEvent) {
		event.preventDefault()
		setCodeError(null)
		const result = await enterCodeFn({ data: { eventId, code, turnstileToken: token } })
		setAttempt((n) => n + 1)
		if (!result.ok) return setCodeError(result.busy ? m.refusal_busy() : m.code_wrong())
		await onSignedIn()
	}

	async function submitEmail(event: FormEvent) {
		event.preventDefault()
		await findProgrammeFn({ data: { eventId, email, turnstileToken: token } })
		setAttempt((n) => n + 1)
		setSent(m.find_programme_sent())
	}

	return (
		<div className="flex flex-col gap-3">
			<details className="group rounded-xl bg-card px-4 py-1 shadow-card open:pb-4">
				<summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 font-bold [&::-webkit-details-marker]:hidden">
					<KeyRound aria-hidden className="size-5 text-muted-foreground" />
					<span className="flex-1">{m.have_code()}</span>
					<ChevronDown
						aria-hidden
						className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
					/>
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
			<details className="group rounded-xl bg-card px-4 py-1 shadow-card open:pb-4">
				<summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 font-bold [&::-webkit-details-marker]:hidden">
					<Mail aria-hidden className="size-5 text-muted-foreground" />
					<span className="flex-1">{m.find_programme()}</span>
					<ChevronDown
						aria-hidden
						className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
					/>
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
			<Turnstile siteKey={turnstileSiteKey} onToken={setToken} resetKey={attempt} />
		</div>
	)
}
