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
		<div className="flex flex-col gap-5 sm:gap-6">
			<div className="flex flex-col gap-2 print:hidden">
				<h1 className="font-display text-[clamp(1.5rem,5vw,2.25rem)] leading-tight font-semibold text-balance wrap-break-word">
					{event.name}
				</h1>
				<p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
					<StatusLabel status={event.status} />
					<span className="flex items-center gap-1.5">
						<CalendarDays aria-hidden className="size-4" />
						{formatDateRange(event.startsOn, event.endsOn)}
					</span>
				</p>
			</div>
			<nav
				aria-label={event.name}
				ref={tabs}
				className="print:hidden flex gap-6 overflow-x-auto border-b border-border whitespace-nowrap [scrollbar-width:none] max-sm:[mask-image:linear-gradient(to_right,black_85%,transparent)]"
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
