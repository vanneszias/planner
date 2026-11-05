import { brand } from '@app/brand'
import { type Mark, pollCalendarFile, rankWindows } from '@app/domain/poll-grid'
import { Button } from '@app/ui/components/button'
import { ConfirmDialog } from '@app/ui/components/dialog'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { cn } from 'cn'
import { type FormEvent, useMemo, useState } from 'react'
import { FormError } from '#/components/auth-shell'
import { Field, FieldInput } from '#/components/field'
import { LanguageSwitch } from '#/components/language-switch'
import {
	BestTimes,
	type Brush,
	formatWindow,
	fromMarks,
	HeatGrid,
	PaintGrid,
	toMarks,
} from '#/components/poll/grid'
import { useLivePoll } from '#/components/poll/use-live-poll'
import { actionMessage } from '#/lib/errors'
import { formatStamp } from '#/lib/format'
import { m } from '#/paraglide/messages'
import { deleteMyResponseFn, getPublicPoll, saveMyResponseFn } from '#/server/poll-public'

/** The shared poll link: mark when you're free, see when everyone else is (docs/availability-polls.md). */
export const Route = createFileRoute('/m/$code')({
	loader: ({ params }) => getPublicPoll({ data: params.code }),
	head: ({ loaderData }) => ({
		meta: loaderData
			? [
					{ title: `${loaderData.poll.title} · ${brand.name}` },
					// Guests land here from their private edit link; never pass the URL on.
					{ name: 'referrer', content: 'no-referrer' },
					{ name: 'robots', content: 'noindex' },
				]
			: [],
	}),
	component: PollPage,
})

type Page = Awaited<ReturnType<typeof getPublicPoll>>

function PollPage() {
	const page: Page = Route.useLoaderData()
	const { poll, respondents, manageId } = page
	useLivePoll(poll.shareCode)
	const windows = useMemo(
		() =>
			rankWindows(
				poll,
				respondents.map((r) => ({ id: r.id, name: r.name ?? '', availability: r.availability })),
			),
		[poll, respondents],
	)
	const names = useMemo(() => new Map(respondents.map((r) => [r.id, r.name])), [respondents])
	const confirmed =
		poll.status === 'confirmed' && poll.confirmedStartsAt && poll.confirmedEndsAt
			? { startsAt: poll.confirmedStartsAt, endsAt: poll.confirmedEndsAt }
			: null

	return (
		<div className="min-h-dvh">
			<header className="mx-auto flex max-w-3xl items-center justify-between px-4 pt-3">
				<span className="font-display text-base font-semibold">{brand.name}</span>
				<LanguageSwitch />
			</header>
			<main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8">
				<div className="flex flex-col gap-2">
					<h1 className="font-display text-[clamp(1.75rem,6vw,2.25rem)] leading-tight font-semibold text-balance wrap-break-word">
						{poll.title}
					</h1>
					{poll.location && <p className="font-bold">{poll.location}</p>}
					{poll.description && (
						<p className="whitespace-pre-line text-muted-foreground">{poll.description}</p>
					)}
					{manageId && (
						<p>
							<Link
								to="/polls/$pollId"
								params={{ pollId: manageId }}
								className="font-bold text-primary underline underline-offset-4"
							>
								{m.poll_manage_link()}
							</Link>
						</p>
					)}
				</div>

				<StatusBanner page={page} confirmed={confirmed} />

				{/* Not keyed on the respondent: a guest's first save must keep showing their edit link. */}
				{poll.status === 'open' && <AnswerForm page={page} />}

				<section aria-labelledby="everyone" className="flex flex-col gap-4">
					<div>
						<h2 id="everyone" className="font-display text-xl font-semibold">
							{m.poll_everyone_title()}
						</h2>
						<p className="text-sm text-muted-foreground">
							{respondents.length === 0
								? m.poll_nobody_yet()
								: m.poll_answers_count({ count: String(respondents.length) })}
							{!poll.showNames && ` ${m.poll_names_hidden()}`}
						</p>
					</div>
					{respondents.length > 0 && (
						<>
							{poll.status !== 'confirmed' && (
								<>
									<h3 className="font-bold">{m.poll_best_times()}</h3>
									<BestTimes windows={windows} timezone={poll.timezone} names={names} />
								</>
							)}
							<HeatGrid shape={poll} respondents={respondents} highlight={confirmed} />
						</>
					)}
				</section>
			</main>
		</div>
	)
}

function StatusBanner({
	page,
	confirmed,
}: {
	page: Page
	confirmed: { startsAt: number; endsAt: number } | null
}) {
	const { poll } = page
	if (confirmed) {
		return (
			<div className="flex flex-col gap-3 rounded-xl border-2 border-primary bg-tint-success p-5">
				<p className="text-sm font-bold">{m.poll_confirmed_label()}</p>
				<p className="font-display text-2xl font-semibold">
					{formatWindow(confirmed.startsAt, confirmed.endsAt, poll.timezone)}
				</p>
				{poll.location && <p>{poll.location}</p>}
				<div>
					<Button
						variant="outline"
						onClick={() =>
							downloadCalendar({
								uid: `${poll.id}@${brand.slug}`,
								title: poll.title,
								description: poll.description,
								location: poll.location,
								url: page.link,
								...confirmed,
							})
						}
					>
						{m.poll_add_to_calendar()}
					</Button>
				</div>
			</div>
		)
	}
	if (poll.status === 'needs_decision') {
		return (
			<p className="rounded-xl bg-tint-warning p-4 font-bold">{m.poll_needs_decision_public()}</p>
		)
	}
	if (poll.status === 'cancelled') {
		return <p className="rounded-xl bg-accent p-4 font-bold">{m.poll_cancelled_public()}</p>
	}
	if (poll.deadlineAt) {
		return (
			<p className="rounded-xl bg-card shadow-card p-4">
				{poll.decisionMode === 'auto'
					? m.poll_auto_deadline({ when: formatStamp(poll.deadlineAt) })
					: m.poll_deadline({ when: formatStamp(poll.deadlineAt) })}
			</p>
		)
	}
	return null
}

function downloadCalendar(input: Parameters<typeof pollCalendarFile>[0]) {
	const blob = new Blob([pollCalendarFile(input)], { type: 'text/calendar;charset=utf-8' })
	const url = URL.createObjectURL(blob)
	const link = document.createElement('a')
	link.href = url
	link.download = `${input.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'event'}.ics`
	link.click()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function AnswerForm({ page }: { page: Page }) {
	const { poll, me, viewer } = page
	const router = useRouter()
	const [name, setName] = useState(me?.name ?? viewer.name)
	const [email, setEmail] = useState(me?.email ?? '')
	const [marks, setMarks] = useState<Map<number, Mark>>(() =>
		toMarks(me?.availability ?? { free: [], ifNeeded: [] }),
	)
	const [brush, setBrush] = useState<Brush>('free')
	const [issues, setIssues] = useState<Record<string, string>>({})
	const [error, setError] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)
	const [editLink, setEditLink] = useState<string | null>(null)
	const [confirmingRemove, setConfirmingRemove] = useState(false)
	const [pending, setPending] = useState(false)

	async function save(event: FormEvent) {
		event.preventDefault()
		setError(null)
		setNotice(null)
		if (!name.trim()) return setIssues({ name: 'required' })
		setPending(true)
		const result = await saveMyResponseFn({
			data: {
				code: poll.shareCode,
				name,
				email: viewer.signedIn || !email.trim() ? null : email.trim(),
				availability: fromMarks(marks),
			},
		})
		setPending(false)
		if (!result.ok) {
			if (result.issues) setIssues(result.issues)
			else setError(result.code === 'conflict' ? m.poll_closed_error() : actionMessage(result))
			return
		}
		setIssues({})
		setNotice(m.poll_saved())
		if (result.data.editLink) setEditLink(result.data.editLink)
		await router.invalidate()
	}

	async function remove() {
		setConfirmingRemove(false)
		setPending(true)
		const result = await deleteMyResponseFn({ data: poll.shareCode })
		setPending(false)
		if (!result.ok) return setError(actionMessage(result))
		setMarks(new Map())
		await router.invalidate()
	}

	const brushes: { value: Brush; label: string }[] = [
		{ value: 'free', label: m.poll_mark_free() },
		{ value: 'ifNeeded', label: m.poll_mark_if_needed() },
		{ value: 'erase', label: m.poll_brush_erase() },
	]

	return (
		<form
			onSubmit={save}
			noValidate
			aria-labelledby="yours"
			className="flex flex-col gap-4 rounded-xl bg-card shadow-card p-5"
		>
			<div>
				<h2 id="yours" className="font-display text-xl font-semibold">
					{me ? m.poll_your_answer() : m.poll_when_free()}
				</h2>
				<p className="text-sm text-muted-foreground">
					{m.poll_paint_help({ hours: String(poll.durationMinutes / 60) })}
				</p>
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				<Field id="name" label={m.poll_your_name()} error={issues.name}>
					<FieldInput
						id="name"
						error={issues.name}
						value={name}
						autoComplete="name"
						onChange={(e) => setName(e.target.value)}
					/>
				</Field>
				{!viewer.signedIn && (
					<Field
						id="email"
						label={m.poll_email_optional()}
						hint={m.poll_email_hint()}
						error={issues.email}
					>
						<FieldInput
							id="email"
							type="email"
							hint
							error={issues.email}
							value={email}
							autoComplete="email"
							onChange={(e) => setEmail(e.target.value)}
						/>
					</Field>
				)}
			</div>

			<fieldset className="flex flex-wrap items-center gap-2">
				<legend className="sr-only">{m.poll_brush_legend()}</legend>
				{brushes.map((option) => (
					<label
						key={option.value}
						className={cn(
							'flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 px-4 font-bold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring',
							brush === option.value ? 'border-primary bg-tint-success' : 'border-input',
						)}
					>
						<input
							type="radio"
							name="brush"
							className="sr-only"
							checked={brush === option.value}
							onChange={() => setBrush(option.value)}
						/>
						<span
							aria-hidden
							className={cn(
								'size-4 rounded-sm border border-primary',
								option.value === 'free' && 'bg-primary',
								option.value === 'ifNeeded' &&
									'bg-tint-success bg-[repeating-linear-gradient(135deg,transparent_0_3px,color-mix(in_srgb,var(--kelp)_45%,transparent)_3px_5px)]',
								option.value === 'erase' && 'border-input bg-card',
							)}
						/>
						{option.label}
					</label>
				))}
			</fieldset>

			<PaintGrid shape={poll} marks={marks} brush={brush} onChange={setMarks} disabled={pending} />

			<FormError message={error} />
			<p aria-live="polite" className="font-bold text-success empty:hidden">
				{notice}
			</p>
			{editLink && (
				<div className="flex flex-col gap-2 rounded-xl bg-tint-success p-4">
					<p className="text-sm">{m.poll_edit_link_intro()}</p>
					<code className="break-all text-sm">{editLink}</code>
					<div>
						<Button
							type="button"
							variant="outline"
							onClick={() => navigator.clipboard?.writeText(editLink)}
						>
							{m.poll_copy_link()}
						</Button>
					</div>
				</div>
			)}

			<div className="flex flex-wrap gap-3">
				<Button type="submit" disabled={pending}>
					{me ? m.poll_save_changes() : m.poll_save_answer()}
				</Button>
				{me && (
					<Button
						type="button"
						variant="ghost"
						disabled={pending}
						onClick={() => setConfirmingRemove(true)}
					>
						{m.poll_remove_answer()}
					</Button>
				)}
			</div>
			<ConfirmDialog
				open={confirmingRemove}
				onOpenChange={setConfirmingRemove}
				title={m.poll_remove_confirm()}
				confirmLabel={m.poll_remove_answer()}
				cancelLabel={m.cancel()}
				onConfirm={remove}
			/>
		</form>
	)
}
