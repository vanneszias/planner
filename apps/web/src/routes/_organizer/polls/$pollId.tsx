import type { UpdatePollInput } from '@app/domain'
import { minutesToTime, rankWindows } from '@app/domain/poll-grid'
import { utcToZoned } from '@app/domain/time'
import { Button } from '@app/ui/components/button'
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { type FormEvent, useMemo, useState } from 'react'
import { FormError } from '#/components/auth-shell'
import { Checkbox } from '#/components/checkbox'
import { Field, FieldInput } from '#/components/field'
import { BestTimes, formatWindow, HeatGrid } from '#/components/poll/grid'
import { PollStatusLabel } from '#/components/poll/status'
import { useLivePoll } from '#/components/poll/use-live-poll'
import { RadioCards } from '#/components/radio-cards'
import { actionMessage } from '#/lib/errors'
import { formatDateRange, formatStamp } from '#/lib/format'
import { m } from '#/paraglide/messages'
import type { ActionResult } from '#/server/organizer'
import {
	confirmPollFn,
	deletePollFn,
	getPollAdmin,
	pollStatusFn,
	updatePollFn,
} from '#/server/polls'

export const Route = createFileRoute('/_organizer/polls/$pollId')({
	loader: ({ params }) => getPollAdmin({ data: params.pollId }),
	component: PollAdmin,
})

type Page = Awaited<ReturnType<typeof getPollAdmin>>

function PollAdmin() {
	const page: Page = Route.useLoaderData()
	const { poll, respondents, waitingFor, link, canEdit, canDelete } = page
	const router = useRouter()
	const navigate = useNavigate()
	useLivePoll(poll.shareCode)
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const [copied, setCopied] = useState(false)

	const windows = useMemo(() => rankWindows(poll, respondents), [poll, respondents])
	const names = useMemo(
		() => new Map<string, string | null>(respondents.map((r) => [r.id, r.name])),
		[respondents],
	)
	const confirmed =
		poll.status === 'confirmed' && poll.confirmedStartsAt && poll.confirmedEndsAt
			? { startsAt: poll.confirmedStartsAt.getTime(), endsAt: poll.confirmedEndsAt.getTime() }
			: null
	const deciding = poll.status === 'open' || poll.status === 'needs_decision'

	async function run(work: () => Promise<ActionResult<unknown>>) {
		setError(null)
		setBusy(true)
		const result = await work()
		setBusy(false)
		if (!result.ok) {
			setError(result.code === 'conflict' ? m.poll_already_decided() : actionMessage(result))
			return false
		}
		await router.invalidate()
		return true
	}

	const confirm = (startsAt: number) => {
		const window = windows.find((w) => w.startsAt === startsAt)
		const when = window ? formatWindow(window.startsAt, window.endsAt, poll.timezone) : ''
		if (!globalThis.confirm(m.poll_confirm_prompt({ when }))) return
		run(() => confirmPollFn({ data: { pollId: poll.id, startsAt } }))
	}

	async function copy() {
		await navigator.clipboard?.writeText(link)
		setCopied(true)
	}

	const shareText = `${poll.title}: ${link}`

	return (
		<div className="flex flex-col gap-8">
			<div className="flex flex-col gap-2">
				<p className="text-sm text-muted-foreground">
					<Link to="/polls" className="underline underline-offset-4">
						{m.polls_title()}
					</Link>
				</p>
				<div className="flex flex-wrap items-center gap-3">
					<h1 className="font-display text-[clamp(1.5rem,5vw,2rem)] font-semibold">{poll.title}</h1>
					<PollStatusLabel status={poll.status} />
				</div>
				<p className="text-muted-foreground">
					{formatDateRange(poll.startsOn, poll.endsOn)} · {minutesToTime(poll.dayStartMinutes)}–
					{minutesToTime(poll.dayEndMinutes)} ·{' '}
					{m.poll_duration_option({ hours: String(poll.durationMinutes / 60) })}
					{poll.location && ` · ${poll.location}`}
				</p>
			</div>

			<section className="flex flex-col gap-3 rounded-xl bg-card shadow-card p-5">
				<h2 className="font-bold">{m.poll_share_title()}</h2>
				<p className="text-sm text-muted-foreground">{m.poll_share_body()}</p>
				<code className="break-all rounded-md bg-accent p-3 text-sm">{link}</code>
				<div className="flex flex-wrap gap-2">
					<Button onClick={copy}>{copied ? m.poll_copied() : m.poll_copy_link()}</Button>
					<Button variant="outline" asChild>
						<a
							href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
							target="_blank"
							rel="noreferrer"
						>
							{m.poll_share_whatsapp()}
						</a>
					</Button>
					<Button variant="outline" asChild>
						<a href={`/m/${poll.shareCode}`}>{m.poll_answer_yourself()}</a>
					</Button>
				</div>
				{waitingFor.length > 0 && (
					<p className="text-sm">
						{m.poll_waiting_for({ names: waitingFor.map((w) => w.name).join(', ') })}
					</p>
				)}
			</section>

			<FormError message={error} />

			{confirmed && (
				<section className="flex flex-col gap-3 rounded-xl border-2 border-primary bg-tint-success p-5">
					<p className="text-sm font-bold">{m.poll_confirmed_label()}</p>
					<p className="font-display text-2xl font-semibold">
						{formatWindow(confirmed.startsAt, confirmed.endsAt, poll.timezone)}
					</p>
					{poll.confirmedAt && (
						<p className="text-sm">
							{m.poll_confirmed_at({ when: formatStamp(poll.confirmedAt.getTime()) })}
						</p>
					)}
					{canEdit && (
						<div>
							<Button
								variant="outline"
								disabled={busy}
								onClick={() => run(() => pollStatusFn({ data: { pollId: poll.id, to: 'open' } }))}
							>
								{m.poll_reopen()}
							</Button>
						</div>
					)}
				</section>
			)}

			{poll.status === 'needs_decision' && (
				<p className="rounded-xl bg-tint-warning p-4 font-bold">{m.poll_needs_decision_admin()}</p>
			)}

			{poll.status === 'cancelled' && (
				<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-accent p-4">
					<p className="font-bold">{m.poll_cancelled_admin()}</p>
					{canEdit && (
						<Button
							variant="outline"
							disabled={busy}
							onClick={() => run(() => pollStatusFn({ data: { pollId: poll.id, to: 'open' } }))}
						>
							{m.poll_reopen()}
						</Button>
					)}
				</div>
			)}

			<section className="flex flex-col gap-4">
				<div>
					<h2 className="font-display text-xl font-semibold">{m.poll_best_times()}</h2>
					<p className="text-sm text-muted-foreground">
						{m.poll_answers_count({ count: String(respondents.length) })}
						{poll.decisionMode === 'auto' &&
							poll.deadlineAt &&
							poll.status === 'open' &&
							` · ${m.poll_auto_deadline({ when: formatStamp(poll.deadlineAt.getTime()) })}`}
					</p>
				</div>
				<BestTimes
					windows={windows}
					timezone={poll.timezone}
					names={names}
					busy={busy}
					onConfirm={canEdit && deciding ? confirm : undefined}
				/>
				{respondents.length > 0 && (
					<HeatGrid shape={poll} respondents={respondents} highlight={confirmed} />
				)}
			</section>

			{respondents.length > 0 && (
				<section className="flex flex-col gap-2">
					<h2 className="font-display text-xl font-semibold">{m.poll_respondents_title()}</h2>
					<ul className="flex flex-col divide-y divide-border rounded-xl bg-card shadow-card">
						{respondents.map((r) => (
							<li key={r.id} className="flex flex-wrap justify-between gap-2 p-3">
								<span className="font-bold">{r.name}</span>
								<span className="text-sm text-muted-foreground">
									{m.poll_marked_cells({
										free: String(r.availability.free.length / 2),
										maybe: String(r.availability.ifNeeded.length / 2),
									})}
								</span>
							</li>
						))}
					</ul>
				</section>
			)}

			{canEdit && <SettingsForm page={page} onSaved={() => router.invalidate()} />}

			{(canEdit || canDelete) && (
				<section className="flex flex-wrap gap-3 border-t border-border pt-6">
					{canEdit && poll.status !== 'cancelled' && (
						<Button
							variant="outline"
							disabled={busy}
							onClick={() => {
								if (globalThis.confirm(m.poll_cancel_prompt()))
									run(() => pollStatusFn({ data: { pollId: poll.id, to: 'cancelled' } }))
							}}
						>
							{m.poll_cancel()}
						</Button>
					)}
					{canDelete && (
						<Button
							variant="destructive"
							disabled={busy}
							onClick={async () => {
								if (!globalThis.confirm(m.poll_delete_prompt())) return
								if (await run(() => deletePollFn({ data: poll.id })))
									await navigate({ to: '/polls' })
							}}
						>
							{m.poll_delete()}
						</Button>
					)}
				</section>
			)}
		</div>
	)
}

function SettingsForm({ page, onSaved }: { page: Page; onSaved: () => void }) {
	const { poll } = page
	const [values, setValues] = useState<Required<UpdatePollInput>>(() => ({
		title: poll.title,
		description: poll.description,
		location: poll.location,
		decisionMode: poll.decisionMode,
		deadline: poll.deadlineAt ? utcToZoned(poll.deadlineAt, poll.timezone) : null,
		minAttendees: poll.minAttendees,
		showNames: poll.showNames,
	}))
	const [issues, setIssues] = useState<Record<string, string>>({})
	const [error, setError] = useState<string | null>(null)
	const [saved, setSaved] = useState(false)
	const [pending, setPending] = useState(false)
	const set = <K extends keyof UpdatePollInput>(key: K, value: Required<UpdatePollInput>[K]) => {
		setValues((v) => ({ ...v, [key]: value }))
		setSaved(false)
	}

	async function submit(event: FormEvent) {
		event.preventDefault()
		setError(null)
		setPending(true)
		const result = await updatePollFn({ data: { pollId: poll.id, values } })
		setPending(false)
		if (!result.ok) {
			if (result.issues) setIssues(result.issues)
			else setError(actionMessage(result))
			return
		}
		setIssues({})
		setSaved(true)
		onSaved()
	}

	const deadline = values.deadline ?? { date: '', time: '20:00' }

	return (
		<details className="rounded-xl bg-card shadow-card p-5">
			<summary className="cursor-pointer font-bold">{m.poll_settings_title()}</summary>
			<form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-4">
				<Field id="title" label={m.poll_title_label()} error={issues.title}>
					<FieldInput
						id="title"
						error={issues.title}
						value={values.title}
						onChange={(e) => set('title', e.target.value)}
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
					<Field id="deadline" label={m.poll_deadline_optional()} error={issues.deadline}>
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
						<FieldInput
							id="deadlineTime"
							type="time"
							step={1800}
							disabled={!values.deadline}
							value={deadline.time}
							onChange={(e) => set('deadline', { ...deadline, time: e.target.value })}
						/>
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
				<FormError message={error} />
				<p aria-live="polite" className="font-bold text-success empty:hidden">
					{saved ? m.poll_settings_saved() : ''}
				</p>
				<div>
					<Button type="submit" disabled={pending}>
						{m.poll_settings_save()}
					</Button>
				</div>
			</form>
		</details>
	)
}
