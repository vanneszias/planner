import { createFileRoute, Link, Outlet, useLocation } from '@tanstack/react-router'
import { CalendarDays } from 'lucide-react'
import { useEffect, useRef } from 'react'
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
	// On phones the tab row scrolls: keep the current tab in view.
	const tabs = useRef<HTMLElement>(null)
	const pathname = useLocation({ select: (location) => location.pathname })
	// biome-ignore lint/correctness/useExhaustiveDependencies: the pathname is what moves the active tab
	useEffect(() => {
		const nav = tabs.current
		const active = nav?.querySelector<HTMLElement>('[aria-current="page"]')
		if (nav && active)
			nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2
	}, [pathname])
	// TanStack marks the current tab with data-status="active" (and aria-current="page").
	const tab =
		'-mb-px border-b-2 border-transparent pb-3 text-[0.9375rem] font-bold text-muted-foreground hover:text-foreground data-[status=active]:border-primary data-[status=active]:text-foreground'

	return (
		<div className="flex flex-col gap-6">
			<div className="print:hidden">
				<div className="flex flex-wrap items-center gap-3">
					<h1 className="font-display text-[clamp(1.5rem,5vw,2.25rem)] leading-tight font-semibold hyphens-auto">
						{event.name}
					</h1>
					<StatusLabel status={event.status} />
				</div>
				<p className="mt-1 flex items-center gap-2 text-muted-foreground">
					<CalendarDays aria-hidden className="size-4" />
					{formatDateRange(event.startsOn, event.endsOn)}
				</p>
			</div>
			<nav
				aria-label={event.name}
				ref={tabs}
				className="print:hidden -mx-4 flex gap-6 overflow-x-auto border-b border-border px-4 whitespace-nowrap [scrollbar-width:none] max-sm:[mask-image:linear-gradient(to_right,black_85%,transparent)]"
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
				{event.mode === 'ranking' && (
					<Link to="/events/$eventId/allocation" params={params} className={tab}>
						{m.nav_allocation()}
					</Link>
				)}
				<Link to="/events/$eventId/participants" params={params} className={tab}>
					{m.nav_participants()}
				</Link>
				<Link to="/events/$eventId/check-in" params={params} className={tab}>
					{m.nav_check_in()}
				</Link>
				<Link to="/events/$eventId/settings" params={params} className={tab}>
					{m.nav_settings()}
				</Link>
			</nav>
			<Outlet />
		</div>
	)
}
