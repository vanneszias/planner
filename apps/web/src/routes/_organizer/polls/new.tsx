import type { CreatePollInput } from '@app/domain'
import { minutesToTime } from '@app/domain/poll-grid'
import { Button } from '@app/ui/components/button'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useEffect, useState } from 'react'
import { FormError } from '#/components/auth-shell'
import { Checkbox } from '#/components/checkbox'
import { Field, FieldInput } from '#/components/field'
import { RadioCards } from '#/components/radio-cards'
import { actionMessage } from '#/lib/errors'
import { timeZones } from '#/lib/time-zones'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import { createPollFn, getPollsDashboard } from '#/server/polls'

export const Route = createFileRoute('/_organizer/polls/new')({
	loader: () => getPollsDashboard(),
	component: NewPoll,
})

const select =
	'min-h-11 w-full rounded-md border border-input bg-card px-3 text-foreground aria-invalid:border-destructive'

/** Every half hour from 00:00 to 24:00. */
const halfHours = Array.from({ length: 49 }, (_, i) => minutesToTime(i * 30))
const durations = [30, 60, 90, 120, 150, 180, 240, 300, 360]

const isoDate = (date: Date) => date.toISOString().slice(0, 10)
const addDays = (days: number) => isoDate(new Date(Date.now() + days * 86_400_000))

function NewPoll() {
	const { groups } = Route.useLoaderData()
	const navigate = useNavigate()
	const [values, setValues] = useState<CreatePollInput>({
		title: '',
		description: '',
		location: '',
		timezone: 'Europe/Brussels',
		locale: getLocale(),
		startsOn: addDays(1),
		endsOn: addDays(14),
		dayStart: '19:00',
		dayEnd: '23:00',
		durationMinutes: 120,
		decisionMode: 'manual',
		deadline: null,
		minAttendees: null,
		showNames: true,
		groupId: null,
	})
	const [issues, setIssues] = useState<Record<string, string>>({})
	const [formError, setFormError] = useState<string | null>(null)
	const [pending, setPending] = useState(false)

	useEffect(() => {
		const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone
		if (timeZones.includes(browserZone)) setValues((v) => ({ ...v, timezone: browserZone }))
	}, [])

	const set = <K extends keyof CreatePollInput>(key: K, value: CreatePollInput[K]) => {
		setValues((v) => ({ ...v, [key]: value }))
		setIssues((i) => {
			const { [key]: _, ...rest } = i
			return rest
		})
	}

	async function submit(event: FormEvent) {
		event.preventDefault()
		setFormError(null)
		if (!values.title.trim()) return setIssues({ title: 'required' })
		setPending(true)
		const result = await createPollFn({ data: values })
		setPending(false)
		if (result.ok) {
			await navigate({ to: '/polls/$pollId', params: { pollId: result.data.id } })
			return
		}
		if (result.issues) {
			// Deadline issues come back as "deadline"; show them on its date field.
			setIssues(result.issues)
			setFormError(m.form_check_fields())
		} else setFormError(actionMessage(result))
	}

	const deadline = values.deadline ?? { date: '', time: '20:00' }

	return (
		<form onSubmit={submit} noValidate className="mx-auto flex max-w-lg flex-col gap-6">
			<div>
				<p className="text-sm text-muted-foreground">
					<Link to="/polls" className="underline underline-offset-4">
						{m.polls_title()}
					</Link>
				</p>
				<h1 className="font-display text-[clamp(1.5rem,5vw,2rem)] font-semibold">{m.poll_new()}</h1>
			</div>

			<section className="flex flex-col gap-4 rounded-xl bg-card p-5">
				<Field id="title" label={m.poll_title_label()} error={issues.title}>
					<FieldInput
						id="title"
						error={issues.title}
						value={values.title}
						placeholder={m.poll_title_placeholder()}
						onChange={(e) => set('title', e.target.value)}
						autoFocus
					/>
				</Field>
				<Field id="location" label={m.poll_location_label()} error={issues.location}>
					<FieldInput
						id="location"
						error={issues.location}
						value={values.location}
						onChange={(e) => set('location', e.target.value)}
					/>
				</Field>
				<Field id="description" label={m.poll_description_label()} error={issues.description}>
					<textarea
						id="description"
						rows={3}
						value={values.description}
						onChange={(e) => set('description', e.target.value)}
						className="rounded-md border border-input bg-card px-3 py-2"
					/>
				</Field>
			</section>

			<section className="flex flex-col gap-4 rounded-xl bg-card p-5">
				<h2 className="font-bold">{m.poll_when_section()}</h2>
				<div className="grid grid-cols-2 gap-4">
					<Field id="startsOn" label={m.poll_from_label()} error={issues.startsOn}>
						<FieldInput
							id="startsOn"
							type="date"
							error={issues.startsOn}
							value={values.startsOn}
							onChange={(e) => set('startsOn', e.target.value)}
						/>
					</Field>
					<Field id="endsOn" label={m.poll_until_label()} error={issues.endsOn}>
						<FieldInput
							id="endsOn"
							type="date"
							error={issues.endsOn}
							value={values.endsOn}
							onChange={(e) => set('endsOn', e.target.value)}
						/>
					</Field>
					<Field id="dayStart" label={m.poll_day_start_label()} error={issues.dayStart}>
						<select
							id="dayStart"
							className={select}
							value={values.dayStart}
							onChange={(e) => set('dayStart', e.target.value)}
						>
							{halfHours.slice(0, -1).map((t) => (
								<option key={t}>{t}</option>
							))}
						</select>
					</Field>
					<Field id="dayEnd" label={m.poll_day_end_label()} error={issues.dayEnd}>
						<select
							id="dayEnd"
							className={select}
							aria-invalid={issues.dayEnd ? true : undefined}
							value={values.dayEnd}
							onChange={(e) => set('dayEnd', e.target.value)}
						>
							{halfHours.slice(1).map((t) => (
								<option key={t}>{t}</option>
							))}
						</select>
					</Field>
				</div>
				<Field
					id="durationMinutes"
					label={m.poll_duration_label()}
					hint={m.poll_duration_hint()}
					error={issues.durationMinutes}
				>
					<select
						id="durationMinutes"
						className={select}
						aria-invalid={issues.durationMinutes ? true : undefined}
						value={values.durationMinutes}
						onChange={(e) => set('durationMinutes', Number(e.target.value))}
					>
						{durations.map((d) => (
							<option key={d} value={d}>
								{m.poll_duration_option({ hours: String(d / 60) })}
							</option>
						))}
					</select>
				</Field>
				<Field id="timezone" label={m.timezone_label()} error={issues.timezone}>
					<select
						id="timezone"
						className={select}
						value={values.timezone}
						onChange={(e) => set('timezone', e.target.value)}
					>
						{timeZones.map((zone) => (
							<option key={zone}>{zone}</option>
						))}
					</select>
				</Field>
			</section>

			<section className="flex flex-col gap-4 rounded-xl bg-card p-5">
				<RadioCards
					name="decisionMode"
					legend={m.poll_decision_legend()}
					value={values.decisionMode}
					onChange={(mode) => set('decisionMode', mode)}
					options={[
						{
							value: 'manual',
							title: m.poll_decision_manual(),
							body: m.poll_decision_manual_body(),
						},
						{ value: 'auto', title: m.poll_decision_auto(), body: m.poll_decision_auto_body() },
					]}
				/>
				<div className="grid grid-cols-2 gap-4">
					<Field
						id="deadline"
						label={
							values.decisionMode === 'auto' ? m.poll_deadline_label() : m.poll_deadline_optional()
						}
						error={issues.deadline}
					>
						<FieldInput
							id="deadline"
							type="date"
							error={issues.deadline}
							value={deadline.date}
							onChange={(e) =>
								set('deadline', e.target.value ? { ...deadline, date: e.target.value } : null)
							}
						/>
					</Field>
					<Field id="deadlineTime" label={m.poll_deadline_time()}>
						<select
							id="deadlineTime"
							className={select}
							disabled={!values.deadline}
							value={deadline.time}
							onChange={(e) => set('deadline', { ...deadline, time: e.target.value })}
						>
							{halfHours.slice(0, -1).map((t) => (
								<option key={t}>{t}</option>
							))}
						</select>
					</Field>
				</div>
				{values.decisionMode === 'auto' && (
					<Field
						id="minAttendees"
						label={m.poll_min_label()}
						hint={m.poll_min_hint()}
						error={issues.minAttendees}
					>
						<FieldInput
							id="minAttendees"
							type="number"
							inputMode="numeric"
							min={1}
							hint
							error={issues.minAttendees}
							value={values.minAttendees ?? ''}
							onChange={(e) => set('minAttendees', e.target.value ? Number(e.target.value) : null)}
						/>
					</Field>
				)}
				<Checkbox
					id="showNames"
					label={m.poll_show_names_label()}
					checked={values.showNames}
					onChange={(checked) => set('showNames', checked)}
				/>
			</section>

			{groups.length > 0 && (
				<section className="flex flex-col gap-4 rounded-xl bg-card p-5">
					<Field
						id="groupId"
						label={m.poll_group_label()}
						hint={m.poll_group_hint()}
						error={issues.groupId}
					>
						<select
							id="groupId"
							className={select}
							value={values.groupId ?? ''}
							onChange={(e) => set('groupId', e.target.value || null)}
						>
							<option value="">{m.poll_group_none()}</option>
							{groups.map((group) => (
								<option key={group.id} value={group.id}>
									{m.poll_group_option({ name: group.name, count: String(group.userIds.length) })}
								</option>
							))}
						</select>
					</Field>
				</section>
			)}

			<FormError message={formError} />
			<div>
				<Button type="submit" disabled={pending}>
					{values.groupId ? m.poll_create_and_invite() : m.poll_create()}
				</Button>
			</div>
		</form>
	)
}
