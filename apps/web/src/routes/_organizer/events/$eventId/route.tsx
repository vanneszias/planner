import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { StatusLabel } from '#/components/status-label'
import { formatDateRange } from '#/lib/format'
import { m } from '#/paraglide/messages'
import { getEventOverview } from '#/server/events'

/** Loads the event once for its tabs; mutations call router.invalidate() to refresh. */
export const Route = createFileRoute('/_organizer/events/$eventId')({
	loader: ({ params }) => getEventOverview({ data: params.eventId }),
	component: EventLayout,
})

function EventLayout() {
	const { event } = Route.useLoaderData()
	const params = { eventId: event.id }
	// TanStack marks the current tab with data-status="active" (and aria-current="page").
	const tab =
		'-mb-px border-b-2 border-transparent px-1 pb-2 font-bold text-muted-foreground hover:text-foreground data-[status=active]:border-primary data-[status=active]:text-foreground'

	return (
		<div className="flex flex-col gap-6">
			<div>
				<div className="flex flex-wrap items-center gap-3">
					<h1 className="font-display text-[clamp(1.5rem,5vw,2.25rem)] leading-tight font-semibold hyphens-auto">
						{event.name}
					</h1>
					<StatusLabel status={event.status} />
				</div>
				<p className="text-muted-foreground">{formatDateRange(event.startsOn, event.endsOn)}</p>
			</div>
			<nav
				aria-label={event.name}
				className="-mx-4 flex gap-5 overflow-x-auto border-b border-border px-4 whitespace-nowrap"
			>
				<Link to="/events/$eventId" params={params} activeOptions={{ exact: true }} className={tab}>
					{m.nav_overview()}
				</Link>
				<Link to="/events/$eventId/workshops" params={params} className={tab}>
					{m.nav_workshops()}
				</Link>
				<Link to="/events/$eventId/schedule" params={params} className={tab}>
					{m.nav_schedule()}
				</Link>
				<Link to="/events/$eventId/settings" params={params} className={tab}>
					{m.nav_settings()}
				</Link>
			</nav>
			<Outlet />
		</div>
	)
}
