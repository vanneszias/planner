import type { CreateEventInput } from '@app/domain'
import { Button } from '@app/ui/components/button'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { FormError } from '#/components/auth-shell'
import { Field, FieldInput } from '#/components/field'
import { RadioCards } from '#/components/radio-cards'
import { actionMessage } from '#/lib/errors'
import { timeZones } from '#/lib/time-zones'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import { createEventFn } from '#/server/events'

export const Route = createFileRoute('/_organizer/events/new')({ component: NewEvent })

/** Which step shows each field, so a server-side error can send the organizer back to it. */
const stepOfField: Record<string, number> = {
	name: 0,
	startsOn: 1,
	endsOn: 1,
	timezone: 1,
	mode: 2,
	sessionsPerParticipant: 3,
}
const totalSteps = 4

/** Guided creation, one question per step, defaults for everything else (journeys.md, O1). */
function NewEvent() {
	const navigate = useNavigate()
	const [step, setStep] = useState(0)
	const [values, setValues] = useState<CreateEventInput>({
		name: '',
		startsOn: '',
		endsOn: '',
		timezone: 'Europe/Brussels',
		mode: 'booking',
		defaultLocale: getLocale(),
		sessionsPerParticipant: 3,
	})
	const [issues, setIssues] = useState<Record<string, string>>({})
	const [formError, setFormError] = useState<string | null>(null)
	const [pending, setPending] = useState(false)
	const heading = useRef<HTMLHeadingElement>(null)
	const firstRender = useRef(true)

	useEffect(() => {
		const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone
		if (timeZones.includes(browserZone)) setValues((v) => ({ ...v, timezone: browserZone }))
	}, [])

	// Move focus to the new question so screen-reader users hear where they are.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs on purpose whenever the step changes
	useEffect(() => {
		if (firstRender.current) {
			firstRender.current = false
			return
		}
		heading.current?.focus()
	}, [step])

	const set = <K extends keyof CreateEventInput>(key: K, value: CreateEventInput[K]) => {
		setValues((v) => ({ ...v, [key]: value }))
		setIssues((i) => {
			const { [key]: _, ...rest } = i
			return rest
		})
	}

	function requiredOnStep(): Record<string, string> {
		const missing: Record<string, string> = {}
		if (step === 0 && !values.name.trim()) missing.name = 'required'
		if (step === 1) {
			if (!values.startsOn) missing.startsOn = 'date'
			if (!values.endsOn) missing.endsOn = 'date'
			if (values.startsOn && values.endsOn && values.endsOn < values.startsOn)
				missing.endsOn = 'date_order'
		}
		return missing
	}

	async function submit(event: FormEvent) {
		event.preventDefault()
		setFormError(null)
		const missing = requiredOnStep()
		if (Object.keys(missing).length > 0) return setIssues(missing)
		if (step < totalSteps - 1) return setStep(step + 1)

		setPending(true)
		const result = await createEventFn({ data: values })
		setPending(false)
		if (result.ok) {
			await navigate({ to: '/events/$eventId', params: { eventId: result.data.id } })
			return
		}
		if (result.issues) {
			setIssues(result.issues)
			const firstStep = Math.min(...Object.keys(result.issues).map((f) => stepOfField[f] ?? step))
			setStep(firstStep)
		} else {
			setFormError(actionMessage(result))
		}
	}

	const questions = [
		m.create_name_question(),
		m.create_dates_question(),
		m.create_mode_question(),
		m.create_sessions_question(),
	]

	return (
		<form onSubmit={submit} noValidate className="mx-auto flex max-w-lg flex-col gap-6">
			<div>
				<p className="text-sm text-muted-foreground">
					{m.step_of({ step: String(step + 1), total: String(totalSteps) })}
				</p>
				<h1
					ref={heading}
					tabIndex={-1}
					className="font-display text-[clamp(1.5rem,5vw,2rem)] font-semibold outline-none"
				>
					{questions[step]}
				</h1>
			</div>

			<div className="flex flex-col gap-4 rounded-xl bg-card p-5">
				{step === 0 && (
					<Field id="name" label={m.event_name_label()} error={issues.name}>
						<FieldInput
							id="name"
							error={issues.name}
							value={values.name}
							onChange={(e) => set('name', e.target.value)}
							autoFocus
						/>
					</Field>
				)}

				{step === 1 && (
					<>
						<div className="grid gap-4 sm:grid-cols-2">
							<Field id="startsOn" label={m.starts_on_label()} error={issues.startsOn}>
								<FieldInput
									id="startsOn"
									type="date"
									error={issues.startsOn}
									value={values.startsOn}
									onChange={(e) => {
										set('startsOn', e.target.value)
										if (!values.endsOn) set('endsOn', e.target.value)
									}}
								/>
							</Field>
							<Field id="endsOn" label={m.ends_on_label()} error={issues.endsOn}>
								<FieldInput
									id="endsOn"
									type="date"
									error={issues.endsOn}
									min={values.startsOn || undefined}
									value={values.endsOn}
									onChange={(e) => set('endsOn', e.target.value)}
								/>
							</Field>
						</div>
						<Field id="timezone" label={m.timezone_label()} error={issues.timezone}>
							<select
								id="timezone"
								className="h-11 rounded-md border border-input bg-card px-3"
								value={values.timezone}
								onChange={(e) => set('timezone', e.target.value)}
							>
								{timeZones.map((zone) => (
									<option key={zone} value={zone}>
										{zone.replace('_', ' ')}
									</option>
								))}
							</select>
						</Field>
					</>
				)}

				{step === 2 && (
					<RadioCards
						name="mode"
						legend={m.create_mode_question()}
						hideLegend
						value={values.mode}
						onChange={(mode) => set('mode', mode)}
						options={[
							{ value: 'booking', title: m.mode_booking_title(), body: m.mode_booking_body() },
							{ value: 'ranking', title: m.mode_ranking_title(), body: m.mode_ranking_body() },
						]}
					/>
				)}

				{step === 3 && (
					<Field
						id="sessionsPerParticipant"
						label={m.sessions_per_participant_label()}
						hint={m.change_later_hint()}
						error={issues.sessionsPerParticipant}
					>
						<FieldInput
							id="sessionsPerParticipant"
							type="number"
							inputMode="numeric"
							min={1}
							max={20}
							hint
							error={issues.sessionsPerParticipant}
							className="max-w-32"
							value={values.sessionsPerParticipant}
							onChange={(e) => set('sessionsPerParticipant', Number(e.target.value))}
						/>
					</Field>
				)}

				<FormError message={formError} />
			</div>

			<div className="flex flex-wrap items-center justify-between gap-3">
				{step === 0 ? (
					<Button variant="ghost" asChild>
						<Link to="/home">{m.cancel()}</Link>
					</Button>
				) : (
					<Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>
						{m.back()}
					</Button>
				)}
				<Button type="submit" disabled={pending}>
					{step < totalSteps - 1 ? m.next() : m.create_submit()}
				</Button>
			</div>
		</form>
	)
}
