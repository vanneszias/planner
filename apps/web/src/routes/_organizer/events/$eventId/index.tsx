import { Button } from '@app/ui/components/button'
import { createFileRoute, getRouteApi, Link, useRouter } from '@tanstack/react-router'
import { cn } from 'cn'
import {
	CalendarClock,
	Check,
	ChevronRight,
	Copy,
	ExternalLink,
	Shapes,
	ShieldCheck,
	Users,
} from 'lucide-react'
import { useState } from 'react'
import { FormError } from '#/components/auth-shell'
import { actionMessage } from '#/lib/errors'
import { formatDateRange } from '#/lib/format'
import { m } from '#/paraglide/messages'
import { anonymiseNowFn, getRetentionFn } from '#/server/event-day'
import { setEventStatusFn } from '#/server/events'

export const Route = createFileRoute('/_organizer/events/$eventId/')({
	loader: ({ params }) => getRetentionFn({ data: params.eventId }),
	component: Overview,
})
const eventRoute = getRouteApi('/_organizer/events/$eventId')

/** Checklist that ticks itself off (journeys.md, O1 step 3). */
function Overview() {
	const { event, workshops, sessions, organizationSlug, canPublish } = eventRoute.useLoaderData()
	const router = useRouter()
	const [error, setError] = useState<string | null>(null)
	const [pending, setPending] = useState(false)
	const params = { eventId: event.id }
	const published = event.status === 'published'
	const publicPath = `/${organizationSlug}/${event.slug}`

	async function setStatus(status: 'published' | 'draft') {
		setError(null)
		setPending(true)
		const result = await setEventStatusFn({ data: { eventId: event.id, status } })
		setPending(false)
		if (!result.ok) return setError(actionMessage(result))
		await router.invalidate()
	}

	const steps = [
		{
			done: workshops.length > 0,
			label: m.checklist_workshops(),
			detail: m.workshop_count({ count: String(workshops.length) }),
			to: '/events/$eventId/workshops',
		},
		{
			done: sessions.length > 0,
			label: m.checklist_sessions(),
			detail: m.session_count({ count: String(sessions.length) }),
			to: '/events/$eventId/schedule',
		},
	] as const

	// Once everything is done the checklist has nothing to say: it steps aside.
	const ready = published && steps.every((step) => step.done)
	const places = sessions.reduce((sum, session) => sum + session.capacity, 0)
	const stats = [
		{ label: m.stat_workshops(), value: workshops.length, icon: <Shapes /> },
		{ label: m.stat_sessions(), value: sessions.length, icon: <CalendarClock /> },
		{ label: m.stat_places(), value: places, icon: <Users /> },
	]

	return (
		<div className="flex flex-col gap-6">
			<dl className="grid grid-cols-3 gap-2 sm:gap-4">
				{stats.map((stat) => (
					<div
						key={stat.label}
						className="flex flex-col gap-1 rounded-xl bg-card shadow-card p-4 sm:p-5"
					>
						<dt className="flex items-center gap-2 text-sm font-bold text-muted-foreground [&_svg]:size-4">
							<span className="max-sm:hidden">{stat.icon}</span>
							{stat.label}
						</dt>
						<dd className="text-2xl font-bold tabular-nums sm:text-3xl">{stat.value}</dd>
					</div>
				))}
			</dl>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
				{!ready && (
					<section
						aria-labelledby="checklist"
						className="min-w-0 rounded-xl bg-card p-5 shadow-card"
					>
						<h2 id="checklist" className="mb-3 text-lg font-bold">
							{m.checklist_title()}
						</h2>
						<ol className="-mx-2 flex flex-col">
							{steps.map((item) => (
								<li key={item.label}>
									<Link
										to={item.to}
										params={params}
										className="group flex min-h-12 items-center gap-3 rounded-lg px-2 hover:bg-accent"
									>
										<CheckDot done={item.done} />
										<span className="flex-1 font-bold">{item.label}</span>
										<span className="text-sm text-muted-foreground">{item.detail}</span>
										<ChevronRight
											aria-hidden
											className="size-4 text-muted-foreground group-hover:text-foreground"
										/>
									</Link>
								</li>
							))}
							<li className="flex min-h-12 items-center gap-3 px-2">
								<CheckDot done={published} />
								<span className="flex-1 font-bold">{m.checklist_publish()}</span>
							</li>
						</ol>
					</section>
				)}

				<section
					className="flex min-w-0 flex-col gap-4 rounded-xl bg-card p-5 shadow-card"
					aria-labelledby="public-page"
					aria-live="polite"
				>
					<h2 id="public-page" className="flex items-center gap-2 text-lg font-bold">
						{m.public_page_label()}
					</h2>
					{published ? (
						<>
							<p className="flex items-center gap-2 text-sm font-bold">
								<span className="size-2 rounded-full bg-success" aria-hidden />
								{m.published_notice()}
							</p>
							<div className="flex items-center gap-2 rounded-lg border border-border bg-background py-1 pr-1 pl-3">
								<span className="min-w-0 flex-1 truncate font-mono text-sm">{publicPath}</span>
								<CopyButton text={() => new URL(publicPath, window.location.origin).href} />
							</div>
						</>
					) : (
						<p className="text-sm text-muted-foreground">{m.draft_notice()}</p>
					)}
					<div className="mt-auto flex flex-wrap gap-2">
						{published && (
							<Button asChild variant="outline" size="sm">
								<a href={publicPath} target="_blank" rel="noreferrer">
									<ExternalLink />
									{m.open_page()}
								</a>
							</Button>
						)}
						{canPublish && (
							<Button
								variant={published ? 'outline' : 'default'}
								size={published ? 'sm' : 'default'}
								className={published ? 'text-destructive hover:text-destructive' : undefined}
								disabled={pending}
								onClick={() => setStatus(published ? 'draft' : 'published')}
							>
								{published ? m.unpublish_button() : m.publish_button()}
							</Button>
						)}
					</div>
					<FormError message={error} />
				</section>
				{ready && <Retention eventId={event.id} />}
			</div>

			{!ready && <Retention eventId={event.id} />}
		</div>
	)
}

/** Copies a link and says so for two seconds. */
function CopyButton({ text }: { text: () => string }) {
	const [copied, setCopied] = useState(false)
	return (
		<Button
			variant="ghost"
			size="sm"
			className="shrink-0"
			onClick={async () => {
				await navigator.clipboard.writeText(text())
				setCopied(true)
				setTimeout(() => setCopied(false), 2000)
			}}
		>
			{copied ? <Check /> : <Copy />}
			<span aria-live="polite">{copied ? m.link_copied() : m.copy_link()}</span>
		</Button>
	)
}

/** When participant data goes (D6, D20), and "Anonymise now" (journeys.md, O9). */
function Retention({ eventId }: { eventId: string }) {
	const retention = Route.useLoaderData()
	const router = useRouter()
	const [confirming, setConfirming] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [pending, setPending] = useState(false)
	const day = (date: string) => formatDateRange(date, date)

	async function anonymise() {
		setError(null)
		setPending(true)
		const result = await anonymiseNowFn({ data: eventId })
		setPending(false)
		setConfirming(false)
		if (!result.ok) return setError(actionMessage(result))
		await router.invalidate()
	}

	return (
		<section
			aria-labelledby="retention"
			className="flex flex-col gap-3 rounded-xl bg-card shadow-card p-5"
		>
			<h2 id="retention" className="flex items-center gap-2 text-lg font-bold">
				<ShieldCheck aria-hidden className="size-5 text-muted-foreground" />
				{m.retention_title()}
			</h2>
			{retention.doneAt ? (
				<p>
					{m.retention_done({ date: day(new Date(retention.doneAt).toISOString().slice(0, 10)) })}
				</p>
			) : (
				<>
					<p className="text-muted-foreground">
						{m.retention_scheduled({ date: day(retention.date) })}
					</p>
					{retention.canAnonymise &&
						(confirming ? (
							<div className="flex flex-col gap-3 rounded-lg bg-tint-warning p-4">
								<p>{m.retention_confirm()}</p>
								<div className="flex flex-wrap gap-2">
									<Button variant="destructive" disabled={pending} onClick={anonymise}>
										{m.retention_anonymise_now()}
									</Button>
									<Button variant="ghost" onClick={() => setConfirming(false)}>
										{m.cancel()}
									</Button>
								</div>
							</div>
						) : (
							<div>
								<Button
									variant="outline"
									size="sm"
									className="text-destructive hover:text-destructive"
									onClick={() => setConfirming(true)}
								>
									{m.retention_anonymise_now()}
								</Button>
							</div>
						))}
				</>
			)}
			<FormError message={error} />
		</section>
	)
}

/** Done state is shown by shape and fill, and announced as text. */
function CheckDot({ done }: { done: boolean }) {
	return (
		<span
			className={cn(
				'grid size-6 shrink-0 place-items-center rounded-full border-2 text-sm font-bold',
				done ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
			)}
		>
			{done && <Check aria-hidden className="size-3.5" strokeWidth={3} />}
			<span className="sr-only">({done ? m.checklist_done() : m.checklist_todo()})</span>
		</span>
	)
}
