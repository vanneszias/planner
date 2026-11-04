import { createFileRoute, Link, Outlet, useLocation } from '@tanstack/react-router'
import { CalendarDays, ChevronLeft } from 'lucide-react'
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

const routes = {
	'': '/events/$eventId',
	'/workshops': '/events/$eventId/workshops',
	'/schedule': '/events/$eventId/schedule',
	'/allocation': '/events/$eventId/allocation',
	'/participants': '/events/$eventId/participants',
	'/check-in': '/events/$eventId/check-in',
	'/settings': '/events/$eventId/settings',
} as const
type Section = { path: keyof typeof routes; label: string }

function EventLayout() {
	const { event } = Route.useLoaderData()
	const params = { eventId: event.id }
	const pathname = useLocation({ select: (location) => location.pathname })
	// Keep the current tab in view on phones.
	const pills = useRef<HTMLElement>(null)
	// biome-ignore lint/correctness/useExhaustiveDependencies: the pathname is what moves the active tab
	useEffect(() => {
		const nav = pills.current
		const active = nav?.querySelector<HTMLElement>('[aria-current="page"]')
		if (!nav || !active) return
		// After layout (fonts can still shift widths): leave one tab of context on the left.
		const frame = requestAnimationFrame(() => {
			nav.scrollLeft += active.getBoundingClientRect().left - nav.getBoundingClientRect().left - 48
		})
		return () => cancelAnimationFrame(frame)
	}, [pathname])
	const sections: Section[] = [
		{ path: '', label: m.nav_overview() },
		{ path: '/workshops', label: m.nav_workshops() },
		{ path: '/schedule', label: m.nav_schedule() },
		...(event.mode === 'ranking'
			? [{ path: '/allocation' as const, label: m.nav_allocation() }]
			: []),
		{ path: '/participants', label: m.nav_participants() },
		{ path: '/check-in', label: m.nav_check_in() },
		{ path: '/settings', label: m.nav_settings() },
	]
	// TanStack marks the current tab with data-status="active" (and aria-current="page").
	const tab =
		'-mb-px border-b-2 border-transparent pb-3 text-[0.9375rem] font-bold whitespace-nowrap text-muted-foreground hover:text-foreground data-[status=active]:border-primary data-[status=active]:text-foreground'

	return (
		<div className="flex flex-col gap-5 sm:gap-6">
			<div className="flex flex-col gap-2 print:hidden">
				<Link
					to="/home"
					className="-ml-1 flex w-fit items-center gap-1 rounded-md px-1 text-sm font-bold text-muted-foreground hover:text-foreground"
				>
					<ChevronLeft aria-hidden className="size-4" />
					{m.back_to_events()}
				</Link>
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
			{/* One tab strip; on phones it scrolls and keeps the current tab in view. */}
			<nav
				aria-label={event.name}
				ref={pills}
				className="flex gap-6 overflow-x-auto border-b border-border [scrollbar-width:none] max-sm:-mx-4 max-sm:scroll-px-4 max-sm:gap-5 max-sm:px-4 max-sm:[mask-image:linear-gradient(to_right,transparent,black_1.25rem,black_calc(100%-2.5rem),transparent)] print:hidden"
			>
				{sections.map((section) => (
					<Link
						key={section.path}
						to={routes[section.path]}
						params={params}
						activeOptions={{ exact: section.path === '' }}
						className={tab}
					>
						{section.label}
					</Link>
				))}
			</nav>
			<Outlet />
		</div>
	)
}
