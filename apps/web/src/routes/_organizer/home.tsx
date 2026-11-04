import { authClient } from '@app/auth/client'
import { Button } from '@app/ui/components/button'
import { createFileRoute, Link } from '@tanstack/react-router'
import { CalendarDays, ChevronRight, KeyRound, Plus } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '#/components/page'
import { StatusLabel } from '#/components/status-label'
import { formatDateRange } from '#/lib/format'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import { getDashboard } from '#/server/events'

export const Route = createFileRoute('/_organizer/home')({
	loader: () => getDashboard(),
	component: Dashboard,
})

function Dashboard() {
	const { organization, events, canCreate } = Route.useLoaderData()

	return (
		<div className="flex flex-col gap-8">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<p className="text-sm text-muted-foreground">{organization?.name}</p>
					<h1 className="font-display text-[clamp(1.75rem,6vw,2.25rem)] font-semibold">
						{m.dashboard_title()}
					</h1>
				</div>
				{canCreate && (
					<Button asChild>
						<Link to="/events/new">
							<Plus />
							{m.create_event()}
						</Link>
					</Button>
				)}
			</div>

			{events.length === 0 ? (
				<EmptyState icon={<CalendarDays />} title={m.events_empty()} />
			) : (
				<ul className="divide-y divide-border overflow-hidden rounded-xl bg-card shadow-card">
					{events.map((event) => (
						<li key={event.id}>
							<Link
								to="/events/$eventId"
								params={{ eventId: event.id }}
								className="group flex items-center gap-4 px-4 py-4 hover:bg-accent/60 sm:px-5"
							>
								<DateBlock date={event.startsOn} />
								<span className="min-w-0 flex-1">
									<span className="line-clamp-2 font-bold">{event.name}</span>
									<span className="text-sm text-muted-foreground">
										{formatDateRange(event.startsOn, event.endsOn)}
									</span>
									<span className="mt-1.5 block sm:hidden">
										<StatusLabel status={event.status} />
									</span>
								</span>
								<span className="max-sm:hidden">
									<StatusLabel status={event.status} />
								</span>
								<ChevronRight
									aria-hidden
									className="size-5 shrink-0 text-muted-foreground group-hover:text-foreground max-sm:hidden"
								/>
							</Link>
						</li>
					))}
				</ul>
			)}

			<PasskeyPrompt />
		</div>
	)
}

function PasskeyPrompt() {
	const [status, setStatus] = useState<string | null>(null)

	async function addPasskey() {
		const result = await authClient.passkey.addPasskey()
		setStatus(result?.error ? m.error_passkey() : m.passkey_added())
	}

	return (
		<section
			aria-labelledby="passkey"
			className="flex flex-wrap items-center gap-4 rounded-xl border border-dashed border-edge/60 p-4 sm:p-5"
		>
			<span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-muted-foreground">
				<KeyRound aria-hidden className="size-5" />
			</span>
			<div className="min-w-48 flex-1">
				<h2 id="passkey" className="font-bold">
					{m.passkey_title()}
				</h2>
				<p className="text-sm text-muted-foreground">{m.passkey_body()}</p>
				<p aria-live="polite" className="mt-1 text-sm font-bold empty:hidden">
					{status}
				</p>
			</div>
			<Button variant="outline" size="sm" onClick={addPasskey}>
				{m.add_passkey_short()}
			</Button>
		</section>
	)
}

/** A tear-off calendar leaf for an event's first day: "JUL / 12". Decorative; the range is in the text. */
function DateBlock({ date }: { date: string }) {
	const day = new Date(`${date}T12:00:00Z`)
	const month = new Intl.DateTimeFormat(getLocale() === 'nl' ? 'nl-BE' : 'en-GB', {
		month: 'short',
		timeZone: 'UTC',
	}).format(day)
	return (
		<span
			aria-hidden
			className="flex w-12 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card text-center leading-none"
		>
			<span className="bg-ink py-1 text-[0.6875rem] font-bold tracking-wide text-white uppercase">
				{month.replace('.', '')}
			</span>
			<span className="py-1.5 text-lg font-bold tabular-nums">{day.getUTCDate()}</span>
		</span>
	)
}
