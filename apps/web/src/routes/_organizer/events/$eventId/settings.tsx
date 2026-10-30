import type { UpdateEventInput } from '@app/domain'
import { Button } from '@app/ui/components/button'
import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { type FormEvent, type ReactNode, useState } from 'react'
import { FormError } from '#/components/auth-shell'
import { Field, FieldInput } from '#/components/field'
import { RadioCards } from '#/components/radio-cards'
import { actionMessage, fieldMessage } from '#/lib/errors'
import { timeZones } from '#/lib/time-zones'
import { m } from '#/paraglide/messages'
import { renameEventSlugFn, saveAgeGroupsFn, updateEventFn } from '#/server/events'

export const Route = createFileRoute('/_organizer/events/$eventId/settings')({
	component: Settings,
})
const eventRoute = getRouteApi('/_organizer/events/$eventId')

type Moment = { date: string; time: string }

/**
 * Everyday settings first; ranking and booking details behind "More options"
 * (progressive disclosure, journeys.md O2 step 4).
 */
function Settings() {
	const { event, window, canEdit } = eventRoute.useLoaderData()
	const router = useRouter()
	const [values, setValues] = useState({
		name: event.name,
		description: event.description,
		startsOn: event.startsOn,
		endsOn: event.endsOn,
		timezone: event.timezone,
		defaultLocale: event.defaultLocale,
		mode: event.mode,
		sessionsPerParticipant: event.sessionsPerParticipant,
		rankLimit: event.rankLimit,
		rankMinimum: event.rankMinimum,
		showTimesWhileRanking: event.showTimesWhileRanking,
		showExplanations: event.showExplanations,
		fillUnassigned: event.fillUnassigned,
		allocationStrategy: event.allocationStrategy,
		changeCutoff: event.changeCutoff,
	})
	const [opens, setOpens] = useState<Moment>(window.opens ?? { date: '', time: '' })
	const [closes, setCloses] = useState<Moment>(window.closes ?? { date: '', time: '' })
	const [issues, setIssues] = useState<Record<string, string>>({})
	const [status, setStatus] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [pending, setPending] = useState(false)

	const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => {
		setValues((v) => ({ ...v, [key]: value }))
		setStatus(null)
	}
	// A half-filled moment means "no window": date and time are both needed.
	const moment = (value: Moment) =>
		value.date ? { date: value.date, time: value.time || '00:00' } : null

	async function submit(formEvent: FormEvent) {
		formEvent.preventDefault()
		setError(null)
		setIssues({})
		setPending(true)
		const payload: UpdateEventInput = { ...values, opens: moment(opens), closes: moment(closes) }
		const result = await updateEventFn({ data: { eventId: event.id, values: payload } })
		setPending(false)
		if (!result.ok) {
			if (result.issues) setIssues(result.issues)
			else setError(actionMessage(result))
			return
		}
		setStatus(m.settings_saved())
		await router.invalidate()
	}

	return (
		<div className="flex flex-col gap-6">
			{canEdit && <WebAddressForm />}
			{canEdit && <AgeGroupsForm />}
			<form onSubmit={submit} noValidate className="flex flex-col gap-6">
				<fieldset disabled={!canEdit} className="contents">
					<Section title={m.settings_basics()}>
						<Field id="name" label={m.event_name_label()} error={issues.name}>
							<FieldInput
								id="name"
								error={issues.name}
								value={values.name}
								onChange={(e) => set('name', e.target.value)}
							/>
						</Field>
						<Field id="description" label={m.description_label()} error={issues.description}>
							<textarea
								id="description"
								rows={4}
								className="rounded-md border border-input bg-card px-3 py-2"
								value={values.description}
								onChange={(e) => set('description', e.target.value)}
							/>
						</Field>
						<div className="grid gap-4 sm:grid-cols-2">
							<Field id="startsOn" label={m.starts_on_label()} error={issues.startsOn}>
								<FieldInput
									id="startsOn"
									type="date"
									error={issues.startsOn}
									value={values.startsOn}
									onChange={(e) => set('startsOn', e.target.value)}
								/>
							</Field>
							<Field id="endsOn" label={m.ends_on_label()} error={issues.endsOn}>
								<FieldInput
									id="endsOn"
									type="date"
									error={issues.endsOn}
									value={values.endsOn}
									onChange={(e) => set('endsOn', e.target.value)}
								/>
							</Field>
						</div>
						<div className="grid gap-4 sm:grid-cols-2">
							<Field id="timezone" label={m.timezone_label()} error={issues.timezone}>
								<select
									id="timezone"
									className="h-11 rounded-md border border-input bg-card px-3"
									value={values.timezone}
									onChange={(e) => set('timezone', e.target.value)}
								>
									{[...new Set([values.timezone, ...timeZones])].map((zone) => (
										<option key={zone} value={zone}>
											{zone.replace('_', ' ')}
										</option>
									))}
								</select>
							</Field>
							<Field
								id="defaultLocale"
								label={m.content_language_label()}
								hint={m.content_language_hint()}
							>
								<select
									id="defaultLocale"
									aria-describedby="defaultLocale-hint"
									className="h-11 rounded-md border border-input bg-card px-3"
									value={values.defaultLocale}
									onChange={(e) => set('defaultLocale', e.target.value as 'en' | 'nl')}
								>
									<option value="en">{m.language_en()}</option>
									<option value="nl">{m.language_nl()}</option>
								</select>
							</Field>
						</div>
					</Section>

					<Section title={m.settings_participation()}>
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
						<Field
							id="sessionsPerParticipant"
							label={m.sessions_per_participant_label()}
							error={issues.sessionsPerParticipant}
						>
							<FieldInput
								id="sessionsPerParticipant"
								type="number"
								inputMode="numeric"
								min={1}
								max={20}
								className="max-w-32"
								error={issues.sessionsPerParticipant}
								value={values.sessionsPerParticipant}
								onChange={(e) => set('sessionsPerParticipant', Number(e.target.value))}
							/>
						</Field>
					</Section>

					<Section title={m.settings_window()} hint={m.window_hint()}>
						<MomentFields
							id="opens"
							label={m.opens_label()}
							value={opens}
							onChange={setOpens}
							error={issues.opens}
						/>
						<MomentFields
							id="closes"
							label={m.closes_label()}
							value={closes}
							onChange={setCloses}
							error={issues.closes}
						/>
					</Section>

					<details className="rounded-xl bg-card p-5 [&_summary]:cursor-pointer">
						<summary className="min-h-11 content-center text-lg font-bold">
							{m.more_options()}
						</summary>
						<div className="mt-4 flex flex-col gap-6">
							{values.mode === 'ranking' ? (
								<>
									<div className="grid gap-4 sm:grid-cols-2">
										<Field id="rankLimit" label={m.rank_limit_label()} error={issues.rankLimit}>
											<FieldInput
												id="rankLimit"
												type="number"
												inputMode="numeric"
												min={1}
												max={20}
												className="max-w-32"
												error={issues.rankLimit}
												value={values.rankLimit}
												onChange={(e) => set('rankLimit', Number(e.target.value))}
											/>
										</Field>
										<Field
											id="rankMinimum"
											label={m.rank_minimum_label()}
											hint={m.rank_minimum_hint()}
											error={issues.rankMinimum}
										>
											<FieldInput
												id="rankMinimum"
												type="number"
												inputMode="numeric"
												min={1}
												max={20}
												hint
												className="max-w-32"
												error={issues.rankMinimum}
												value={values.rankMinimum ?? ''}
												onChange={(e) =>
													set('rankMinimum', e.target.value === '' ? null : Number(e.target.value))
												}
											/>
										</Field>
									</div>
									<Checkbox
										id="showTimesWhileRanking"
										label={m.show_times_label()}
										checked={values.showTimesWhileRanking}
										onChange={(checked) => set('showTimesWhileRanking', checked)}
									/>
									<Checkbox
										id="showExplanations"
										label={m.show_explanations_label()}
										checked={values.showExplanations}
										onChange={(checked) => set('showExplanations', checked)}
									/>
									<RadioCards
										name="fillUnassigned"
										legend={m.empty_slots_legend()}
										value={values.fillUnassigned}
										onChange={(fill) => set('fillUnassigned', fill)}
										options={[
											{ value: 'none', title: m.fill_none() },
											{ value: 'any-open', title: m.fill_any_open() },
										]}
									/>
									<RadioCards
										name="allocationStrategy"
										legend={m.strategy_legend()}
										value={values.allocationStrategy}
										onChange={(strategy) => set('allocationStrategy', strategy)}
										options={[
											{
												value: 'take-turns',
												title: m.strategy_take_turns(),
												body: m.strategy_take_turns_body(),
											},
											{
												value: 'early-birds',
												title: m.strategy_early_birds(),
												body: m.strategy_early_birds_body(),
											},
										]}
									/>
								</>
							) : (
								<RadioCards
									name="changeCutoff"
									legend={m.cutoff_legend()}
									value={values.changeCutoff}
									onChange={(cutoff) => set('changeCutoff', cutoff)}
									options={[
										{ value: 'booking-closes', title: m.cutoff_booking_closes() },
										{ value: 'session-start', title: m.cutoff_session_start() },
									]}
								/>
							)}
						</div>
					</details>
				</fieldset>

				{canEdit && (
					<div className="flex flex-wrap items-center gap-4">
						<Button type="submit" disabled={pending}>
							{m.save_settings()}
						</Button>
						<p aria-live="polite" className="font-bold empty:hidden">
							{status}
						</p>
					</div>
				)}
				<FormError message={error} />
			</form>
		</div>
	)
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-4 rounded-xl bg-card p-5">
			<div>
				<h2 className="text-lg font-bold">{title}</h2>
				{hint && <p className="text-sm text-muted-foreground">{hint}</p>}
			</div>
			{children}
		</section>
	)
}

function MomentFields({
	id,
	label,
	value,
	onChange,
	error,
}: {
	id: string
	label: string
	value: Moment
	onChange: (value: Moment) => void
	error?: string
}) {
	return (
		<fieldset className="flex flex-col gap-2">
			<legend className="mb-2 font-bold">{label}</legend>
			<div className="flex flex-wrap gap-3">
				<Field id={`${id}-date`} label={m.date_label()}>
					<FieldInput
						id={`${id}-date`}
						type="date"
						error={error}
						value={value.date}
						onChange={(e) => onChange({ ...value, date: e.target.value })}
					/>
				</Field>
				<Field id={`${id}-time`} label={m.time_label()}>
					<FieldInput
						id={`${id}-time`}
						type="time"
						value={value.time}
						onChange={(e) => onChange({ ...value, time: e.target.value })}
					/>
				</Field>
			</div>
			{error && (
				<p id={`${id}-date-error`} className="text-sm font-bold text-destructive">
					{fieldMessage(error)}
				</p>
			)}
		</fieldset>
	)
}

function Checkbox({
	id,
	label,
	checked,
	onChange,
}: {
	id: string
	label: string
	checked: boolean
	onChange: (checked: boolean) => void
}) {
	return (
		<label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3">
			<input
				id={id}
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
				className="size-5 shrink-0 accent-[var(--kelp)]"
			/>
			{label}
		</label>
	)
}

/** The event's public address. Renaming keeps old links and QR codes working (D19). */
function WebAddressForm() {
	const { event, organizationSlug } = eventRoute.useLoaderData()
	const router = useRouter()
	const [slug, setSlug] = useState(event.slug)
	const [issue, setIssue] = useState<string | undefined>()
	const [status, setStatus] = useState<string | null>(null)
	const [pending, setPending] = useState(false)

	async function submit(formEvent: FormEvent) {
		formEvent.preventDefault()
		setIssue(undefined)
		setStatus(null)
		setPending(true)
		const result = await renameEventSlugFn({ data: { eventId: event.id, slug } })
		setPending(false)
		if (!result.ok) return setIssue(result.issues?.slug ?? 'required')
		setSlug(result.data)
		setStatus(m.address_saved())
		await router.invalidate()
	}

	return (
		<form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-xl bg-card p-5">
			<Field id="slug" label={m.web_address_label()} hint={m.web_address_hint()} error={issue}>
				<div className="flex items-center gap-1">
					<span className="font-mono text-muted-foreground">/{organizationSlug}/</span>
					<FieldInput
						id="slug"
						hint
						error={issue}
						className="font-mono"
						value={slug}
						onChange={(e) => setSlug(e.target.value)}
					/>
				</div>
			</Field>
			<div className="flex flex-wrap items-center gap-4">
				<Button type="submit" variant="outline" disabled={pending || slug === event.slug}>
					{m.save_address()}
				</Button>
				<p aria-live="polite" className="font-bold empty:hidden">
					{status}
				</p>
			</div>
		</form>
	)
}

/** Optional age groups (D2). Removing one also removes it from workshops. */
function AgeGroupsForm() {
	const { event, ageGroups } = eventRoute.useLoaderData()
	const router = useRouter()
	const [groups, setGroups] = useState<{ id?: string; label: string }[]>(ageGroups)
	const [issues, setIssues] = useState<Record<string, string>>({})
	const [status, setStatus] = useState<string | null>(null)
	const [pending, setPending] = useState(false)

	async function submit(formEvent: FormEvent) {
		formEvent.preventDefault()
		setIssues({})
		setStatus(null)
		setPending(true)
		const kept = groups.filter((group) => group.label.trim())
		const result = await saveAgeGroupsFn({ data: { eventId: event.id, groups: kept } })
		setPending(false)
		if (!result.ok) return setIssues(result.issues ?? {})
		setGroups(result.data)
		setStatus(m.age_groups_saved())
		await router.invalidate()
	}

	return (
		<form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-xl bg-card p-5">
			<div>
				<h2 className="text-lg font-bold">{m.age_groups_title()}</h2>
				<p className="text-sm text-muted-foreground">{m.age_groups_hint()}</p>
			</div>
			{groups.map((group, index) => {
				const id = `age-group-${index}`
				const issue = issues[`${index}.label`]
				return (
					<div key={group.id ?? `new-${index}`} className="flex items-end gap-2">
						<div className="flex-1">
							<Field id={id} label={m.age_group_label({ number: String(index + 1) })} error={issue}>
								<FieldInput
									id={id}
									error={issue}
									value={group.label}
									onChange={(e) =>
										setGroups((all) =>
											all.map((g, i) => (i === index ? { ...g, label: e.target.value } : g)),
										)
									}
								/>
							</Field>
						</div>
						<Button
							type="button"
							variant="ghost"
							aria-label={`${m.remove_age_group()}: ${group.label || m.age_group_label({ number: String(index + 1) })}`}
							onClick={() => setGroups((all) => all.filter((_, i) => i !== index))}
						>
							{m.remove_age_group()}
						</Button>
					</div>
				)
			})}
			<div className="flex flex-wrap items-center gap-3">
				<Button
					type="button"
					variant="outline"
					onClick={() => setGroups((all) => [...all, { label: '' }])}
				>
					{m.add_age_group()}
				</Button>
				<Button type="submit" disabled={pending}>
					{m.save_age_groups()}
				</Button>
				<p aria-live="polite" className="font-bold empty:hidden">
					{status}
				</p>
			</div>
		</form>
	)
}
