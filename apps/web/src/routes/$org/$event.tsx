import { brand } from '@app/brand'
import { Marker } from '@app/ui/components/marker'
import { createFileRoute } from '@tanstack/react-router'
import { LanguageSwitch } from '#/components/language-switch'
import { formatDateRange, formatTime, groupByDay } from '#/lib/format'
import { m } from '#/paraglide/messages'
import { getPublicEventFn } from '#/server/public'

/** Public event page (journeys.md, P1 step 1). Booking and ranking arrive in M3 and M4. */
export const Route = createFileRoute('/$org/$event')({
	loader: ({ params }) => getPublicEventFn({ data: { org: params.org, event: params.event } }),
	head: ({ loaderData }) => ({
		meta: loaderData
			? [
					{ title: `${loaderData.event.name} · ${brand.name}` },
					{ name: 'description', content: loaderData.event.description.slice(0, 160) },
				]
			: [],
	}),
	component: PublicEvent,
})

function PublicEvent() {
	const { event, workshops, sessions } = Route.useLoaderData()
	const workshopById = new Map(workshops.map((w) => [w.id, w]))
	const days = groupByDay(sessions, event.timezone)

	return (
		<div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-6">
			<div className="flex justify-end">
				<LanguageSwitch />
			</div>

			{/* Organizer-written text is marked with the event's language for screen readers. */}
			<header
				className="rounded-2xl p-5 text-white"
				style={{ background: event.accentColor ?? 'var(--kelp)' }}
			>
				<h1
					lang={event.defaultLocale}
					className="font-display text-[clamp(1.75rem,7vw,2.5rem)] leading-tight font-semibold hyphens-auto"
				>
					{event.name}
				</h1>
				<p className="mt-1">{formatDateRange(event.startsOn, event.endsOn)}</p>
				<p className="mt-1 text-sm opacity-95">
					{m.organized_by({ name: event.organizationName })}
				</p>
			</header>

			{event.description && (
				<p lang={event.defaultLocale} className="whitespace-pre-line">
					{event.description}
				</p>
			)}

			<section aria-labelledby="programme" className="flex flex-col gap-4">
				<h2 id="programme" className="font-display text-xl font-medium">
					{m.programme_title()}
				</h2>
				{days.length === 0 && <p className="rounded-xl bg-card p-5">{m.programme_empty()}</p>}
				{days.map((day) => (
					<div key={day.label} className="flex flex-col gap-2">
						<h3 className="font-bold first-letter:uppercase">{day.label}</h3>
						<ul className="flex flex-col gap-2">
							{day.items.map((session) => {
								const workshop = workshopById.get(session.workshopId)
								if (!workshop) return null
								return (
									<li key={session.id} className="flex items-start gap-3 rounded-xl bg-card p-4">
										<Marker
											color={workshop.markerColor}
											shape={workshop.markerShape}
											className="mt-0.5"
										/>
										<div className="flex-1">
											<p className="font-bold" lang={event.defaultLocale}>
												{workshop.title}
											</p>
											<p className="text-sm text-muted-foreground">
												{session.room ? `${session.room} · ` : ''}
												{m.places({ count: String(session.capacity) })}
											</p>
											{workshop.ageGroups.length > 0 && (
												<p className="text-sm font-bold" lang={event.defaultLocale}>
													{m.for_ages({ groups: workshop.ageGroups.join(', ') })}
												</p>
											)}
										</div>
										<span className="font-mono">
											{formatTime(session.startsAt, event.timezone)}
										</span>
									</li>
								)
							})}
						</ul>
					</div>
				))}
			</section>
		</div>
	)
}
