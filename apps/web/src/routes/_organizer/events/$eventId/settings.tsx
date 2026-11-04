import type { UpdateEventInput } from '@app/domain'
import { Button } from '@app/ui/components/button'
import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { Check, ChevronDown, Plus, Trash2 } from 'lucide-react'
import { type ComponentProps, type FormEvent, type ReactNode, useState } from 'react'
import { FormError } from '#/components/auth-shell'
import { Field, FieldInput, FieldSelect, PrefixedInput } from '#/components/field'
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
	const { event, window, canEdit, ageGroups } = eventRoute.useLoaderData()
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
	const [slug, setSlug] = useState(event.slug)
	const [slugIssue, setSlugIssue] = useState<string | undefined>()
	const [groups, setGroups] = useState<{ id?: string; label: string }[]>(ageGroups)
	const [groupIssues, setGroupIssues] = useState<Record<string, string>>({})
	const [dirty, setDirty] = useState(false)
	/** Any edit: mark the form dirty and clear the last "saved". */
	const touched =
		<T,>(apply: (value: T) => void) =>
		(value: T) => {
			apply(value)
			setDirty(true)
			setStatus(null)
		}

	const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => {
		setValues((v) => ({ ...v, [key]: value }))
		setDirty(true)
		setStatus(null)
	}
	// A half-filled moment means "no window": date and time are both needed.
	const moment = (value: Moment) =>
		value.date ? { date: value.date, time: value.time || '00:00' } : null

	async function submit(formEvent: FormEvent) {
		formEvent.preventDefault()
		setError(null)
		setIssues({})
		setSlugIssue(undefined)
		setGroupIssues({})
		setPending(true)
		// One save button for the page: address, age groups, then everything else.
		if (slug !== event.slug) {
			const renamed = await renameEventSlugFn({ data: { eventId: event.id, slug } })
			if (!renamed.ok) {
				setPending(false)
				return setSlugIssue(renamed.issues?.slug ?? 'required')
			}
			setSlug(renamed.data)
		}
		const kept = groups.filter((group) => group.label.trim())
		if (JSON.stringify(kept) !== JSON.stringify(ageGroups)) {
			const saved = await saveAgeGroupsFn({ data: { eventId: event.id, groups: kept } })
			if (!saved.ok) {
				setPending(false)
				return setGroupIssues(saved.issues ?? {})
			}
			setGroups(saved.data)
		}
		const payload: UpdateEventInput = { ...values, opens: moment(opens), closes: moment(closes) }
		const result = await updateEventFn({ data: { eventId: event.id, values: payload } })
		setPending(false)
		if (!result.ok) {
			if (result.issues) setIssues(result.issues)
			else setError(actionMessage(result))
			return
		}
		setStatus(m.settings_saved())
		setDirty(false)
		await router.invalidate()
	}

	return (
		<div className="flex flex-col gap-6">
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
								className="rounded-md border border-input bg-card px-3 py-2 shadow-xs"
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
								<FieldSelect
									id="timezone"
									value={values.timezone}
									onChange={(e) => set('timezone', e.target.value)}
								>
									{[...new Set([values.timezone, ...timeZones])].map((zone) => (
										<option key={zone} value={zone}>
											{zone.replace('_', ' ')}
										</option>
									))}
								</FieldSelect>
							</Field>
							<Field
								id="defaultLocale"
								label={m.content_language_label()}
								hint={m.content_language_hint()}
							>
								<FieldSelect
									id="defaultLocale"
									aria-describedby="defaultLocale-hint"
									value={values.defaultLocale}
									onChange={(e) => set('defaultLocale', e.target.value as 'en' | 'nl')}
								>
									<option value="en">{m.language_en()}</option>
									<option value="nl">{m.language_nl()}</option>
								</FieldSelect>
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
							onChange={touched(setOpens)}
							error={issues.opens}
						/>
						<MomentFields
							id="closes"
							label={m.closes_label()}
							value={closes}
							onChange={touched(setCloses)}
							error={issues.closes}
						/>
					</Section>

					<WebAddressSection slug={slug} onChange={touched(setSlug)} issue={slugIssue} />
					<AgeGroupsSection groups={groups} onChange={touched(setGroups)} issues={groupIssues} />

					<details className="group rounded-xl bg-card px-5 py-2 shadow-card open:pb-5">
						<summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 text-lg font-bold [&::-webkit-details-marker]:hidden">
							<span className="flex-1">{m.more_options()}</span>
							<ChevronDown
								aria-hidden
								className="size-5 text-muted-foreground transition-transform group-open:rotate-180"
							/>
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
					<div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
						<FormError message={error} />
						{dirty && (
							<p className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
								<span className="size-2 rounded-full bg-[var(--marker-sun)]" aria-hidden />
								{m.unsaved_changes()}
							</p>
						)}
						<p
							aria-live="polite"
							className="flex items-center gap-2 text-sm font-bold empty:hidden"
						>
							{status && <Check aria-hidden className="size-4 text-success" strokeWidth={3} />}
							{status}
						</p>
						<Button type="submit" disabled={pending}>
							{m.save_settings()}
						</Button>
					</div>
				)}
			</form>
		</div>
	)
}

/** A titled settings block: label column on the left on wide screens, fields on the right. */
function Section({
	title,
	hint,
	children,
	as: Tag = 'section',
	...props
}: {
	title: string
	hint?: string
	children: ReactNode
	as?: 'section' | 'form'
} & Omit<ComponentProps<'form'>, 'title' | 'children'>) {
	return (
		<Tag
			className="grid gap-x-8 gap-y-4 rounded-xl bg-card p-5 shadow-card md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
			{...props}
		>
			<div>
				<h2 className="font-bold">{title}</h2>
				{hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
			</div>
			<div className="flex min-w-0 flex-col gap-4">{children}</div>
		</Tag>
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
function WebAddressSection({
	slug,
	onChange,
	issue,
}: {
	slug: string
	onChange: (slug: string) => void
	issue?: string
}) {
	const { organizationSlug } = eventRoute.useLoaderData()
	return (
		<Section title={m.web_address_label()} hint={m.web_address_hint()}>
			<Field id="slug" label={m.web_address_label()} error={issue}>
				<PrefixedInput
					prefix={`/${organizationSlug}/`}
					id="slug"
					error={issue}
					value={slug}
					onChange={(e) => onChange(e.target.value)}
				/>
			</Field>
		</Section>
	)
}

type Group = { id?: string; label: string }

/** Optional age groups (D2). Removing one also removes it from workshops. */
function AgeGroupsSection({
	groups,
	onChange,
	issues,
}: {
	groups: Group[]
	onChange: (groups: Group[]) => void
	issues: Record<string, string>
}) {
	return (
		<Section title={m.age_groups_title()} hint={m.age_groups_hint()}>
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
										onChange(
											groups.map((g, i) => (i === index ? { ...g, label: e.target.value } : g)),
										)
									}
								/>
							</Field>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="text-muted-foreground hover:bg-tint-danger hover:text-destructive"
							title={m.remove_age_group()}
							aria-label={`${m.remove_age_group()}: ${group.label || m.age_group_label({ number: String(index + 1) })}`}
							onClick={() => onChange(groups.filter((_, i) => i !== index))}
						>
							<Trash2 />
						</Button>
					</div>
				)
			})}
			<div>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => onChange([...groups, { label: '' }])}
				>
					<Plus />
					{m.add_age_group()}
				</Button>
			</div>
		</Section>
	)
}
