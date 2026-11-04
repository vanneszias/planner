import { createFileRoute, Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { CalendarDays, ChevronLeft } from 'lucide-react'
import { FieldSelect } from '#/components/field'
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
	const navigate = useNavigate()
	const pathname = useLocation({ select: (location) => location.pathname })
	const base = `/events/${event.id}`
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
	const current =
		sections.find((s) => s.path && pathname.startsWith(`${base}${s.path}`))?.path ?? ''
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
			{/* Phones: every section in one picker instead of a clipped tab strip. */}
			<FieldSelect
				aria-label={m.section_label()}
				className="sm:hidden print:hidden"
				value={current}
				onChange={(e) => navigate({ to: routes[e.target.value as Section['path']], params })}
			>
				{sections.map((section) => (
					<option key={section.path} value={section.path}>
						{section.label}
					</option>
				))}
			</FieldSelect>
			<nav
				aria-label={event.name}
				className="flex gap-6 border-b border-border max-sm:hidden print:hidden"
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
