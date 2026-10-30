import { authClient } from '@app/auth/client'
import { Button } from '@app/ui/components/button'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { StatusLabel } from '#/components/status-label'
import { formatDateRange } from '#/lib/format'
import { m } from '#/paraglide/messages'
import { getDashboard } from '#/server/events'

export const Route = createFileRoute('/_organizer/home')({
	loader: () => getDashboard(),
	component: Dashboard,
})

function Dashboard() {
	const { organization, events, canCreate } = Route.useLoaderData()

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<p className="text-sm text-muted-foreground">{organization?.name}</p>
					<h1 className="font-display text-[clamp(1.75rem,6vw,2.25rem)] font-semibold">
						{m.dashboard_title()}
					</h1>
				</div>
				{canCreate && (
					<Button asChild>
						<Link to="/events/new">{m.create_event()}</Link>
					</Button>
				)}
			</div>

			{events.length === 0 ? (
				<p className="rounded-xl bg-card p-6">{m.events_empty()}</p>
			) : (
				<ul className="flex flex-col gap-3">
					{events.map((event) => (
						<li key={event.id}>
							<Link
								to="/events/$eventId"
								params={{ eventId: event.id }}
								className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card p-4 hover:bg-accent"
							>
								<span>
									<span className="block text-lg font-bold">{event.name}</span>
									<span className="text-sm text-muted-foreground">
										{formatDateRange(event.startsOn, event.endsOn)}
									</span>
								</span>
								<StatusLabel status={event.status} />
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
		<div className="flex flex-col items-start gap-2 border-t border-border pt-6">
			<Button variant="outline" onClick={addPasskey}>
				{m.add_passkey()}
			</Button>
			<p aria-live="polite" className="text-sm empty:hidden">
				{status}
			</p>
		</div>
	)
}
