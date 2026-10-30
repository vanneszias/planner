import { brand } from '@app/brand'
import { Button } from '@app/ui/components/button'
import { Marker } from '@app/ui/components/marker'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { cn } from 'cn'
import { useState } from 'react'
import { DayStrip } from '#/components/event/day-strip'
import { RegisterForm, ReturningForms } from '#/components/event/forms'
import { useLiveSeats } from '#/components/event/use-live-seats'
import { LanguageSwitch } from '#/components/language-switch'
import { formatDateRange, formatDateTime, formatTime, groupByDay } from '#/lib/format'
import { m } from '#/paraglide/messages'
import {
	bookFn,
	cancelFn,
	cancelRegistrationFn,
	getEventPage,
	joinWaitlistFn,
	leaveWaitlistFn,
} from '#/server/participant'

/** Public event page (journeys.md, P1–P5). Booking mode works here; ranking arrives in M4. */
export const Route = createFileRoute('/$org/$event')({
	// Must accept its own output: the router validates again with what this returns.
	validateSearch: (search: Record<string, unknown>): { cancel?: boolean } => ({
		cancel: [true, 1, '1'].includes(search.cancel as never) ? true : undefined,
	}),
	loader: ({ params }) => getEventPage({ data: { org: params.org, event: params.event } }),
	head: ({ loaderData }) => ({
		meta: loaderData
			? [
					{ title: `${loaderData.event.name} · ${brand.name}` },
					{ name: 'description', content: loaderData.event.description.slice(0, 160) },
					// Private links land here after /r/<token>; never leak the URL onward.
					{ name: 'referrer', content: 'no-referrer' },
				]
			: [],
	}),
	component: EventPage,
})

type Page = Awaited<ReturnType<typeof getEventPage>>
type Session = Page['sessions'][number]

const refusals: Record<string, () => string> = {
	full: m.refusal_full,
	overlap: m.refusal_overlap,
	same_workshop: m.refusal_same_workshop,
	limit: m.refusal_limit,
	closed: m.refusal_closed,
	not_eligible: m.refusal_not_eligible,
	too_late: m.refusal_too_late,
	not_found: m.error_not_found,
	already_booked: m.booked,
}

function EventPage() {
	const page: Page = Route.useLoaderData()
	const { cancel } = Route.useSearch()
	const router = useRouter()
	const { event, workshops, sessions, ageGroups, me } = page
	const seats = useLiveSeats(event.id, page.seats)
	const [tab, setTab] = useState<'programme' | 'myday'>('programme')
	const [registeringFor, setRegisteringFor] = useState<string | 'none' | null>(null)
	const [notice, setNotice] = useState<string | null>(null)
	const [busy, setBusy] = useState<string | null>(null)
	const [cancelled, setCancelled] = useState(false)

	const workshopById = new Map(workshops.map((w) => [w.id, w]))
	const booked = new Set(me?.bookings.map((b) => b.sessionId))
	const waitlisted = new Map(me?.waitlist.map((w) => [w.sessionId, w.position]))
	const mine = sessions.filter((s) => booked.has(s.id))
	const now = Date.now()
	const opensAt = event.opensAt ? new Date(event.opensAt) : null
	const closesAt = event.closesAt ? new Date(event.closesAt) : null
	const bookingMode = event.mode === 'booking'
	const open =
		bookingMode &&
		event.status === 'published' &&
		(!opensAt || now >= opensAt.getTime()) &&
		(!closesAt || now < closesAt.getTime())

	async function act(sessionId: string, run: () => Promise<{ ok: boolean; reason?: string }>) {
		setBusy(sessionId)
		setNotice(null)
		const result = await run()
		setBusy(null)
		if (!result.ok && result.reason) setNotice((refusals[result.reason] ?? m.error_generic)())
		await router.invalidate()
	}

	function stateOf(session: Session) {
		const taken = seats[session.id] ?? 0
		const left = Math.max(0, session.capacity - taken)
		const workshop = workshopById.get(session.workshopId)
		if (booked.has(session.id)) return { text: m.booked(), action: 'cancel' as const }
		const position = waitlisted.get(session.id)
		if (position)
			return { text: m.waitlist_position({ position: String(position) }), action: 'leave' as const }
		const myGroup = ageGroups.find((g) => g.id === me?.ageGroupId)?.label
		if (me && workshop?.ageGroups.length && !(myGroup && workshop.ageGroups.includes(myGroup))) {
			return { text: m.not_for_your_age(), action: null }
		}
		const clash = mine.find((s) => s.startsAt < session.endsAt && session.startsAt < s.endsAt)
		if (clash) {
			return {
				text: m.overlaps_with({ workshop: workshopById.get(clash.workshopId)?.title ?? '' }),
				action: null,
			}
		}
		if (left === 0) return { text: m.session_full(), action: me ? ('join' as const) : null }
		if (me && mine.length >= event.sessionsPerParticipant) {
			return { text: m.places_left({ count: String(left) }), action: null }
		}
		return { text: m.places_left({ count: String(left) }), action: 'book' as const }
	}

	if (cancelled) {
		return (
			<Shell page={page}>
				<p className="rounded-xl bg-card p-5 font-bold" role="status">
					{m.registration_cancelled()}
				</p>
			</Shell>
		)
	}

	return (
		<Shell page={page}>
			{me && cancel && (
				<section className="flex flex-col gap-3 rounded-xl bg-tint-warning p-5">
					<p>{m.cancel_registration_confirm({ event: event.name })}</p>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="destructive"
							onClick={async () => {
								await cancelRegistrationFn({ data: { eventId: event.id } })
								setCancelled(true)
							}}
						>
							{m.cancel_registration()}
						</Button>
						<Button variant="ghost" onClick={() => router.navigate({ to: '.', search: {} })}>
							{m.cancel()}
						</Button>
					</div>
				</section>
			)}

			{me && (
				<div className="flex flex-wrap items-baseline justify-between gap-2">
					<p className="text-lg font-bold">{m.hello_name({ name: me.name })}</p>
					{bookingMode && (
						<p className="text-sm text-muted-foreground">
							{m.booked_count({
								booked: String(mine.length),
								total: String(event.sessionsPerParticipant),
							})}
						</p>
					)}
				</div>
			)}

			{me && (
				<div role="tablist" aria-label={event.name} className="flex gap-1 rounded-xl bg-accent p-1">
					{(
						[
							['programme', m.tab_programme()],
							['myday', m.tab_my_day()],
						] as const
					).map(([value, label]) => (
						<button
							key={value}
							type="button"
							role="tab"
							aria-selected={tab === value}
							className={cn(
								'min-h-11 flex-1 rounded-lg font-bold text-muted-foreground',
								tab === value && 'bg-card text-foreground',
							)}
							onClick={() => setTab(value)}
						>
							{label}
						</button>
					))}
				</div>
			)}

			<p aria-live="polite" className="font-bold empty:hidden" role="status">
				{notice}
			</p>

			{registeringFor && (
				<RegisterForm
					eventId={event.id}
					sessionId={registeringFor === 'none' ? undefined : registeringFor}
					ageGroups={ageGroups}
					turnstileSiteKey={page.turnstileSiteKey}
					onCancel={() => setRegisteringFor(null)}
					onDone={async (message, refusal) => {
						setRegisteringFor(null)
						setNotice(refusal ? `${message} ${(refusals[refusal] ?? m.error_generic)()}` : message)
						await router.invalidate()
					}}
				/>
			)}

			{tab === 'myday' && me ? (
				mine.length === 0 ? (
					<p className="rounded-xl bg-card p-5">{m.my_day_empty()}</p>
				) : (
					<DayStrip
						timeZone={event.timezone}
						contentLocale={event.defaultLocale}
						sessions={mine.map((s) => {
							const w = workshopById.get(s.workshopId)
							return {
								id: s.id,
								startsAt: s.startsAt,
								endsAt: s.endsAt,
								room: s.room,
								title: w?.title ?? '',
								markerColor: w?.markerColor ?? 'sea',
								markerShape: w?.markerShape ?? 'circle',
							}
						})}
					/>
				)
			) : (
				<section aria-labelledby="programme" className="flex flex-col gap-4">
					<h2 id="programme" className="font-display text-xl font-medium">
						{m.programme_title()}
					</h2>
					{bookingMode && !open && (
						<p className="rounded-xl bg-tint-warning p-4 font-bold">
							{opensAt && now < opensAt.getTime()
								? m.booking_opens({ when: formatDateTime(opensAt, event.timezone) })
								: m.booking_closed()}
						</p>
					)}
					{groupByDay(sessions, event.timezone).length === 0 && (
						<p className="rounded-xl bg-card p-5">{m.programme_empty()}</p>
					)}
					{groupByDay(sessions, event.timezone).map((day) => (
						<div key={day.label} className="flex flex-col gap-2">
							<h3 className="font-bold first-letter:uppercase">{day.label}</h3>
							<ul className="flex flex-col gap-2">
								{day.items.map((session) => {
									const workshop = workshopById.get(session.workshopId)
									if (!workshop) return null
									const state = bookingMode ? stateOf(session) : null
									const label = `${workshop.title} ${formatTime(session.startsAt, event.timezone)}`
									return (
										<li key={session.id} className="flex flex-col gap-3 rounded-xl bg-card p-4">
											<div className="flex items-start gap-3">
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
														{state ? state.text : m.places({ count: String(session.capacity) })}
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
											</div>
											{open && state?.action === 'book' && (
												<Button
													variant={me ? 'default' : 'outline'}
													aria-label={`${m.book_session()}: ${label}`}
													disabled={busy === session.id}
													onClick={() =>
														me
															? act(session.id, () =>
																	bookFn({ data: { eventId: event.id, sessionId: session.id } }),
																)
															: setRegisteringFor(session.id)
													}
												>
													{m.book_session()}
												</Button>
											)}
											{open && state?.action === 'cancel' && (
												<Button
													variant="outline"
													aria-label={`${m.cancel_booking()}: ${label}`}
													disabled={busy === session.id}
													onClick={() =>
														act(session.id, () =>
															cancelFn({ data: { eventId: event.id, sessionId: session.id } }),
														)
													}
												>
													{m.cancel_booking()}
												</Button>
											)}
											{open && state?.action === 'join' && (
												<Button
													variant="outline"
													aria-label={`${m.join_waitlist()}: ${label}`}
													disabled={busy === session.id}
													onClick={() =>
														act(session.id, () =>
															joinWaitlistFn({
																data: { eventId: event.id, sessionId: session.id },
															}),
														)
													}
												>
													{m.join_waitlist()}
												</Button>
											)}
											{open && state?.action === 'leave' && (
												<Button
													variant="ghost"
													aria-label={`${m.leave_waitlist()}: ${label}`}
													disabled={busy === session.id}
													onClick={() =>
														act(session.id, () =>
															leaveWaitlistFn({
																data: { eventId: event.id, sessionId: session.id },
															}),
														)
													}
												>
													{m.leave_waitlist()}
												</Button>
											)}
										</li>
									)
								})}
							</ul>
						</div>
					))}
				</section>
			)}

			{!me && (
				<ReturningForms
					eventId={event.id}
					turnstileSiteKey={page.turnstileSiteKey}
					onSignedIn={() => router.invalidate()}
				/>
			)}

			{me && tab === 'myday' && (
				<div>
					<Button
						variant="ghost"
						onClick={() => router.navigate({ to: '.', search: { cancel: true } })}
					>
						{m.cancel_registration()}
					</Button>
				</div>
			)}
		</Shell>
	)
}

/** Header band and outer layout shared by every state of the page. */
function Shell({ page, children }: { page: Page; children: React.ReactNode }) {
	const { event } = page
	return (
		<div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-6">
			<div className="flex justify-end">
				<LanguageSwitch />
			</div>
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
			{children}
		</div>
	)
}
