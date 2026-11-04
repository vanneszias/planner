import { brand } from '@app/brand'
import { Button } from '@app/ui/components/button'
import { Dialog } from '@app/ui/components/dialog'
import { Marker } from '@app/ui/components/marker'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { cn } from 'cn'
import { Ban, CalendarDays, Check, Hourglass } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { BrandMark } from '#/components/brand-mark'
import { DayStrip } from '#/components/event/day-strip'
import { Explanation } from '#/components/event/explanation'
import { RegisterForm, ReturningForms } from '#/components/event/forms'
import { RankList } from '#/components/event/rank-list'
import { useLiveSeats } from '#/components/event/use-live-seats'
import { LanguageSwitch } from '#/components/language-switch'
import { EmptyState } from '#/components/page'
import {
	formatDateRange,
	formatDateTime,
	formatShortDayTime,
	formatTime,
	groupByDay,
	groupBySlot,
} from '#/lib/format'
import { m } from '#/paraglide/messages'
import {
	bookFn,
	cancelFn,
	cancelRegistrationFn,
	getEventPage,
	joinWaitlistFn,
	leaveWaitlistFn,
	savePreferencesFn,
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
	busy: m.refusal_busy,
	not_found: m.error_not_found,
	already_booked: m.booked,
}

function EventPage() {
	const page: Page = Route.useLoaderData()
	const { cancel } = Route.useSearch()
	const router = useRouter()
	const { event, workshops, sessions, ageGroups, me } = page
	const seats = useLiveSeats(event.id, page.seats)
	// Once results are published, participants land on their programme.
	const [tab, setTab] = useState<'programme' | 'myday'>(
		me && page.published ? 'myday' : 'programme',
	)
	const [registeringFor, setRegisteringFor] = useState<string | 'none' | null>(null)
	const [notice, setNotice] = useState<string | null>(null)
	const [busy, setBusy] = useState<string | null>(null)
	const [cancelled, setCancelled] = useState(false)

	const workshopById = new Map(workshops.map((w) => [w.id, w]))
	const registeringWorkshop =
		registeringFor && registeringFor !== 'none'
			? workshopById.get(sessions.find((s) => s.id === registeringFor)?.workshopId ?? '')
			: undefined
	const booked = new Set(me?.bookings.map((b) => b.sessionId))
	const waitlisted = new Map(me?.waitlist.map((w) => [w.sessionId, w.position]))
	const mine = sessions.filter((s) => booked.has(s.id))
	const now = Date.now()
	const opensAt = event.opensAt ? new Date(event.opensAt) : null
	const closesAt = event.closesAt ? new Date(event.closesAt) : null
	const bookingMode = event.mode === 'booking'
	const rankingMode = event.mode === 'ranking'
	const open =
		bookingMode &&
		event.status === 'published' &&
		(!opensAt || now >= opensAt.getTime()) &&
		(!closesAt || now < closesAt.getTime())
	const rankingOpen =
		rankingMode &&
		event.status === 'published' &&
		(!opensAt || now >= opensAt.getTime()) &&
		(!closesAt || now < closesAt.getTime())

	async function saveRanking(workshopIds: string[]): Promise<string | null> {
		const result = await savePreferencesFn({ data: { eventId: event.id, workshopIds } })
		if (result.ok) {
			await router.invalidate()
			return null
		}
		if (result.reason === 'closed') return m.ranking_closed()
		if (result.reason === 'not_eligible') return m.refusal_not_eligible()
		if (result.reason === 'busy') return m.refusal_busy()
		return m.error_generic()
	}

	/**
	 * Books, cancels or queues, then says what happened and puts focus back
	 * on that session's button (its label changes, the element may not).
	 */
	async function act(
		sessionId: string,
		run: () => Promise<{ ok: boolean; reason?: string }>,
		success: string,
	) {
		if (busy) return
		setBusy(sessionId)
		setNotice(null)
		const result = await run()
		setBusy(null)
		setNotice(
			result.ok ? success : result.reason ? (refusals[result.reason] ?? m.error_generic)() : null,
		)
		refocus.current = sessionId
		await router.invalidate()
		// Nothing to focus (the session lost its button): don't grab focus later.
		setTimeout(() => {
			refocus.current = null
		}, 1000)
	}

	// After the page re-renders with the new state, focus that session's button again.
	const refocus = useRef<string | null>(null)
	useEffect(() => {
		if (!refocus.current) return
		const target = document.querySelector<HTMLElement>(`[data-session-action="${refocus.current}"]`)
		if (target && document.activeElement !== target) {
			target.focus()
			refocus.current = null
		}
	})

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
				<p className="rounded-xl bg-card shadow-card p-5 font-bold" role="status">
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

			<p
				aria-live="polite"
				className="flex items-center gap-2 rounded-lg bg-accent px-4 py-3 font-bold empty:hidden"
				role="status"
			>
				{notice}
			</p>

			<Dialog
				open={registeringFor !== null}
				onOpenChange={(isOpen) => !isOpen && setRegisteringFor(null)}
				title={rankingMode ? m.register_title_rank() : m.register_title()}
				description={m.register_intro()}
				icon={
					registeringWorkshop && (
						<Marker
							color={registeringWorkshop.markerColor}
							shape={registeringWorkshop.markerShape}
						/>
					)
				}
				closeLabel={m.close()}
			>
				{registeringFor && (
					<RegisterForm
						eventId={event.id}
						sessionId={registeringFor === 'none' ? undefined : registeringFor}
						ageGroups={ageGroups}
						suggestedAgeGroups={registeringWorkshop?.ageGroups}
						turnstileSiteKey={page.turnstileSiteKey}
						onCancel={() => setRegisteringFor(null)}
						onDone={async (message, refusal) => {
							setRegisteringFor(null)
							setNotice(
								refusal ? `${message} ${(refusals[refusal] ?? m.error_generic)()}` : message,
							)
							await router.invalidate()
						}}
					/>
				)}
			</Dialog>

			{rankingMode &&
				!page.published &&
				tab === 'programme' &&
				(me ? (
					rankingOpen ? (
						<RankList
							contentLocale={event.defaultLocale}
							initial={me.ranking}
							rules={me.rules}
							onSave={saveRanking}
							workshops={workshops
								.filter((w) => me.rankable.includes(w.id))
								.map((w) => ({
									id: w.id,
									title: w.title,
									markerColor: w.markerColor,
									markerShape: w.markerShape,
									times: event.showTimesWhileRanking
										? sessions
												.filter((s) => s.workshopId === w.id)
												.map((s) => formatShortDayTime(s.startsAt, event.timezone))
										: [],
								}))}
						/>
					) : (
						<EmptyState icon={<Hourglass />} title={m.ranking_waiting()} />
					)
				) : (
					rankingOpen && (
						<section className="flex flex-wrap items-center gap-4 rounded-xl bg-card p-5 shadow-card">
							<div className="min-w-56 flex-1">
								<h2 className="font-display text-xl font-semibold">{m.rank_title()}</h2>
								<p className="text-muted-foreground">{m.register_intro()}</p>
							</div>
							<Button onClick={() => setRegisteringFor('none')}>{m.register_only()}</Button>
						</section>
					)
				))}

			{bookingMode && !me && open && (
				<section className="flex flex-wrap items-center gap-4 rounded-xl bg-card p-5 shadow-card">
					<div className="min-w-56 flex-1">
						<h2 className="font-display text-xl font-semibold">{m.book_title()}</h2>
						<p className="text-muted-foreground">
							{m.book_intro({ count: String(event.sessionsPerParticipant) })}
						</p>
					</div>
					<Button onClick={() => setRegisteringFor('none')}>{m.register_only()}</Button>
				</section>
			)}

			{!me && (
				<ReturningForms
					eventId={event.id}
					turnstileSiteKey={page.turnstileSiteKey}
					onSignedIn={() => router.invalidate()}
				/>
			)}

			{tab === 'myday' && me ? (
				mine.length === 0 ? (
					<EmptyState
						icon={<CalendarDays />}
						title={rankingMode ? m.my_day_empty_ranking() : m.my_day_empty()}
					/>
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
			) : null}
			{tab === 'myday' && me?.explanation && (
				<Explanation trace={me.explanation} titleOf={(id) => workshopById.get(id)?.title ?? ''} />
			)}
			{tab === 'myday' && me ? null : (
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
						<p className="rounded-xl bg-card shadow-card p-5">{m.programme_empty()}</p>
					)}
					{groupByDay(sessions, event.timezone).length > 1 && (
						<nav
							aria-label={m.jump_to_day()}
							className="sticky top-0 z-10 -mx-4 flex gap-2 overflow-x-auto bg-background/95 px-4 py-2 backdrop-blur [scrollbar-width:none]"
						>
							{groupByDay(sessions, event.timezone).map((day, index) => (
								<a
									key={day.label}
									href={`#day-${index}`}
									className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-bold whitespace-nowrap first-letter:uppercase hover:border-edge"
								>
									{day.label}
								</a>
							))}
						</nav>
					)}
					{groupByDay(sessions, event.timezone).map((day, dayIndex) => (
						<div
							key={day.label}
							id={`day-${dayIndex}`}
							className="flex scroll-mt-16 flex-col gap-4"
						>
							<h3 className="font-display text-lg font-semibold first-letter:uppercase">
								{day.label}
							</h3>
							{groupBySlot(day.items).map((slot) => (
								<div key={slot.startsAt.getTime()} className="flex flex-col gap-2">
									<h4 className="flex items-baseline gap-3">
										<span className="font-bold tabular-nums">
											{formatTime(slot.startsAt, event.timezone)}–
											{formatTime(slot.endsAt, event.timezone)}
										</span>
										<span className="text-sm text-muted-foreground">
											{m.slot_count({ count: String(slot.items.length) })}
										</span>
									</h4>
									<ul className="divide-y divide-border overflow-hidden rounded-xl bg-card shadow-card">
										{slot.items.map((session) => {
											const workshop = workshopById.get(session.workshopId)
											if (!workshop) return null
											const state = bookingMode ? stateOf(session) : null
											const label = `${workshop.title} ${formatTime(session.startsAt, event.timezone)}`
											return (
												<li
													key={session.id}
													className={cn(
														'flex items-center gap-3 bg-card px-4 py-3',
														state?.action === 'cancel' && 'bg-tint-success',
														me && state && state.action === null && 'bg-background/60',
													)}
												>
													<div className="flex flex-1 items-start gap-3">
														<Marker
															color={workshop.markerColor}
															shape={workshop.markerShape}
															className="mt-0.5"
														/>
														<div className="flex-1">
															<p className="flex flex-wrap items-center gap-x-2 gap-y-1">
																<span className="font-bold" lang={event.defaultLocale}>
																	{workshop.title}
																</span>
																{workshop.ageGroups.length > 0 && (
																	<span
																		className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold"
																		lang={event.defaultLocale}
																	>
																		{m.for_ages({ groups: workshop.ageGroups.join(', ') })}
																	</span>
																)}
															</p>
															<p className="flex items-center gap-1.5 text-sm text-muted-foreground">
																{me && state && state.action === null && (
																	<Ban aria-hidden className="size-3.5 shrink-0" />
																)}
																{state?.action === 'cancel' && (
																	<Check
																		aria-hidden
																		className="size-3.5 shrink-0 text-success"
																		strokeWidth={3}
																	/>
																)}
																<span>
																	{session.room ? `${session.room} · ` : ''}
																	{state
																		? state.text
																		: m.places({ count: String(session.capacity) })}
																</span>
															</p>
														</div>
													</div>
													{open && state?.action === 'book' && (
														<Button
															size="sm"
															className="h-10 shrink-0 sm:min-w-28"
															variant={me ? 'default' : 'outline'}
															aria-label={`${m.book_session()}: ${label}`}
															data-session-action={session.id}
															aria-disabled={busy === session.id || undefined}
															onClick={() =>
																me
																	? act(
																			session.id,
																			() =>
																				bookFn({
																					data: { eventId: event.id, sessionId: session.id },
																				}),
																			m.booked_notice({ session: label }),
																		)
																	: setRegisteringFor(session.id)
															}
														>
															<span className="sm:hidden">{m.book_short()}</span>
															<span className="max-sm:hidden">{m.book_session()}</span>
														</Button>
													)}
													{open && state?.action === 'cancel' && (
														<Button
															size="sm"
															className="h-10 shrink-0 sm:min-w-28"
															variant="outline"
															aria-label={`${m.cancel_booking()}: ${label}`}
															data-session-action={session.id}
															aria-disabled={busy === session.id || undefined}
															onClick={() =>
																act(
																	session.id,
																	() =>
																		cancelFn({
																			data: { eventId: event.id, sessionId: session.id },
																		}),
																	m.cancelled_notice({ session: label }),
																)
															}
														>
															{m.cancel_booking()}
														</Button>
													)}
													{open && state?.action === 'join' && (
														<Button
															size="sm"
															className="h-10 shrink-0 sm:min-w-28"
															variant="outline"
															aria-label={`${m.join_waitlist()}: ${label}`}
															data-session-action={session.id}
															aria-disabled={busy === session.id || undefined}
															onClick={() =>
																act(
																	session.id,
																	() =>
																		joinWaitlistFn({
																			data: { eventId: event.id, sessionId: session.id },
																		}),
																	m.waitlist_joined_notice({ session: label }),
																)
															}
														>
															{m.join_waitlist()}
														</Button>
													)}
													{open && state?.action === 'leave' && (
														<Button
															size="sm"
															className="h-10 shrink-0 sm:min-w-28"
															variant="ghost"
															aria-label={`${m.leave_waitlist()}: ${label}`}
															data-session-action={session.id}
															aria-disabled={busy === session.id || undefined}
															onClick={() =>
																act(
																	session.id,
																	() =>
																		leaveWaitlistFn({
																			data: { eventId: event.id, sessionId: session.id },
																		}),
																	m.waitlist_left_notice({ session: label }),
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
						</div>
					))}
				</section>
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

/** Header and outer layout shared by every state of the page. */
function Shell({ page, children }: { page: Page; children: React.ReactNode }) {
	const { event } = page
	return (
		<div className="min-h-dvh">
			<div className="h-1.5" style={{ background: event.accentColor ?? 'var(--kelp)' }} />
			<main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 pt-4 pb-10">
				<div className="flex items-center justify-between">
					<span className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
						<BrandMark className="size-5" />
						{event.organizationName}
					</span>
					<LanguageSwitch />
				</div>
				<header className="flex flex-col gap-3 pt-2">
					<h1
						lang={event.defaultLocale}
						className="font-display text-[clamp(1.875rem,7vw,2.75rem)] leading-[1.1] font-semibold text-balance wrap-break-word"
					>
						{event.name}
					</h1>
					<p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
						<span className="flex items-center gap-1.5">
							<CalendarDays aria-hidden className="size-4" />
							{formatDateRange(event.startsOn, event.endsOn)}
						</span>
						<span>{m.organized_by({ name: event.organizationName })}</span>
					</p>
					<MarkerRow workshops={page.workshops} />
				</header>
				{event.description && (
					<p lang={event.defaultLocale} className="whitespace-pre-line">
						{event.description}
					</p>
				)}
				{children}
			</main>
		</div>
	)
}

/** A strip of the programme's stickers: the page's one burst of colour. */
function MarkerRow({ workshops }: { workshops: Page['workshops'] }) {
	if (workshops.length === 0) return null
	return (
		<div aria-hidden className="flex flex-wrap gap-1.5 pt-1">
			{workshops.slice(0, 16).map((w) => (
				<Marker key={w.id} color={w.markerColor} shape={w.markerShape} className="size-4" />
			))}
		</div>
	)
}
