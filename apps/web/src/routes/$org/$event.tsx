import { brand } from '@app/brand'
import { Button } from '@app/ui/components/button'
import { Dialog } from '@app/ui/components/dialog'
import { Marker } from '@app/ui/components/marker'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { cn } from 'cn'
import {
	Ban,
	CalendarDays,
	Check,
	ChevronDown,
	CircleCheck,
	Hourglass,
	Plus,
	TriangleAlert,
	X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { BrandMark } from '#/components/brand-mark'
import { DayStrip } from '#/components/event/day-strip'
import { Explanation } from '#/components/event/explanation'
import { RegisterForm, ReturningForms } from '#/components/event/forms'
import { PassCards } from '#/components/event/pass-card'
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
	sessionCount,
} from '#/lib/format'
import { shareMeta } from '#/lib/site'
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
					...shareMeta({
						title: loaderData.event.name,
						description:
							loaderData.event.description.slice(0, 160) ||
							m.share_event_description({ organization: loaderData.event.organizationName }),
					}),
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
	const { org, event: eventSlug } = Route.useParams()
	const seats = useLiveSeats(event.id, page.seats)
	// Once results are published, participants land on their programme.
	const [tab, setTab] = useState<'programme' | 'myday'>(
		me && page.published ? 'myday' : 'programme',
	)
	const [registeringFor, setRegisteringFor] = useState<string | 'none' | null>(null)
	const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null)
	const [busy, setBusy] = useState<string | null>(null)
	const [cancelled, setCancelled] = useState(false)
	const [availableOnly, setAvailableOnly] = useState(false)

	const workshopById = new Map(workshops.map((w) => [w.id, w]))
	const registeringSession =
		registeringFor && registeringFor !== 'none'
			? sessions.find((s) => s.id === registeringFor)
			: undefined
	const registeringWorkshop = workshopById.get(registeringSession?.workshopId ?? '')
	const booked = new Set(me?.bookings.map((b) => b.sessionId))
	const waitlisted = new Map(me?.waitlist.map((w) => [w.sessionId, w.position]))
	const mine = sessions.filter((s) => booked.has(s.id))
	// Programme slots with nothing of mine overlapping: My day offers them as prompts.
	const openSlots = groupByDay(sessions, event.timezone)
		.flatMap((day) => groupBySlot(day.items))
		.filter((slot) => !mine.some((s) => s.startsAt < slot.endsAt && slot.startsAt < s.endsAt))
		.map(({ startsAt, endsAt }) => ({ startsAt, endsAt }))
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
			result.ok
				? { text: success, ok: true }
				: result.reason
					? { text: (refusals[result.reason] ?? m.error_generic)(), ok: false }
					: null,
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

	/** With "only sessions I can book" on, hide what can't be booked (keep my own bookings). */
	const shown = (session: Session) => {
		if (!availableOnly || !bookingMode) return true
		const action = stateOf(session).action
		return action === 'book' || action === 'cancel' || action === 'leave'
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
		const sameWorkshop = mine.find((s) => s.workshopId === session.workshopId)
		if (sameWorkshop) {
			return {
				text: m.already_booked_at({
					when: formatShortDayTime(sameWorkshop.startsAt, event.timezone),
				}),
				action: null,
			}
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
			return {
				text: left === 1 ? m.place_left_one() : m.places_left({ count: String(left) }),
				action: null,
			}
		}
		return {
			text: left === 1 ? m.place_left_one() : m.places_left({ count: String(left) }),
			action: 'book' as const,
			// Last fifth of the places (at least two): say so at a glance.
			scarce: left <= Math.max(2, Math.floor(session.capacity / 5)),
		}
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

	const intro =
		rankingMode && !page.published && rankingOpen
			? {
					title: m.rank_title(),
					body: m.rank_intro_anonymous({
						min: String(
							Math.min(
								event.rankMinimum ?? event.sessionsPerParticipant + 1,
								event.rankLimit,
								workshops.length,
							),
						),
						max: String(Math.min(event.rankLimit, workshops.length)),
						sessions: String(event.sessionsPerParticipant),
					}),
				}
			: bookingMode && open
				? {
						title: m.book_title(),
						body: m.book_intro({ count: String(event.sessionsPerParticipant) }),
					}
				: null
	const rail = me ? (
		<>
			<section
				className={cn(
					'flex flex-col gap-3',
					!(rankingMode && !page.published) && 'rounded-xl bg-card p-5 shadow-card',
				)}
			>
				<div>
					<p className="font-display text-xl font-semibold">{m.hello_name({ name: me.name })}</p>
				</div>
				{bookingMode && (
					<div className="flex flex-col gap-1.5">
						<p className="text-sm font-bold tabular-nums">
							{m.booked_count({
								booked: String(mine.length),
								total: String(event.sessionsPerParticipant),
							})}
						</p>
						<span className="h-1.5 overflow-hidden rounded-full bg-accent" aria-hidden>
							<span
								className="block h-full rounded-full bg-primary"
								style={{
									width: `${Math.min(100, (mine.length / Math.max(1, event.sessionsPerParticipant)) * 100)}%`,
								}}
							/>
						</span>
					</div>
				)}
				{!(rankingMode && !page.published) && (
					<div
						role="tablist"
						aria-label={event.name}
						className="flex gap-1 rounded-lg bg-accent p-1"
					>
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
									'min-h-10 flex-1 rounded-md text-sm font-bold text-muted-foreground',
									tab === value && 'bg-card text-foreground shadow-card',
								)}
								onClick={() => setTab(value)}
							>
								{label}
							</button>
						))}
					</div>
				)}
			</section>
			<Button
				variant="ghost"
				size="sm"
				className="h-auto self-start px-0 text-muted-foreground hover:bg-transparent hover:text-destructive max-lg:hidden"
				onClick={() => router.navigate({ to: '.', search: { cancel: true } })}
			>
				{m.cancel_registration()}
			</Button>
		</>
	) : (
		<>
			{intro && (
				<section className="flex flex-col items-start gap-3 rounded-xl bg-card p-5 shadow-card">
					<h2 className="font-display text-xl font-semibold">{intro.title}</h2>
					<p className="text-muted-foreground">{intro.body}</p>
					<Button className="w-full" onClick={() => setRegisteringFor('none')}>
						{m.register_only()}
					</Button>
					<a
						href="#programme-list"
						className="self-center text-sm font-bold text-primary underline-offset-4 hover:underline lg:hidden"
					>
						{m.browse_programme()} ↓
					</a>
				</section>
			)}
			<ReturningForms
				eventId={event.id}
				turnstileSiteKey={page.turnstileSiteKey}
				onSignedIn={() => router.invalidate()}
			/>
		</>
	)

	return (
		<Shell page={page} aside={rail}>
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

			<div aria-live="polite" role="status">
				{notice && (
					<p
						className={cn(
							'flex items-start gap-2.5 rounded-lg py-3 pr-2 pl-4 font-bold',
							notice.ok ? 'bg-tint-success' : 'bg-tint-warning',
						)}
					>
						{notice.ok ? (
							<CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
						) : (
							<TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
						)}
						<span className="flex-1">{notice.text}</span>
						<Button
							variant="ghost"
							size="icon-sm"
							className="-my-1"
							aria-label={m.close()}
							onClick={() => setNotice(null)}
						>
							<X />
						</Button>
					</p>
				)}
			</div>

			<Dialog
				open={registeringFor !== null}
				onOpenChange={(isOpen) => !isOpen && setRegisteringFor(null)}
				title={rankingMode ? m.register_title_rank() : m.register_title()}
				description={
					registeringSession && registeringWorkshop ? (
						<>
							<span className="block font-bold text-foreground">{registeringWorkshop.title}</span>
							<span className="mb-1 block text-foreground tabular-nums">
								{formatShortDayTime(registeringSession.startsAt, event.timezone)}–
								{formatTime(registeringSession.endsAt, event.timezone)}
								{registeringSession.room && (
									<span className="whitespace-nowrap"> · {registeringSession.room}</span>
								)}
							</span>
							{m.register_intro()}
						</>
					) : (
						m.register_intro()
					)
				}
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
								refusal
									? { text: `${message} ${(refusals[refusal] ?? m.error_generic)()}`, ok: false }
									: {
											text:
												registeringSession && registeringWorkshop
													? `${message} ${m.booked_notice({
															session: `${registeringWorkshop.title} ${formatShortDayTime(registeringSession.startsAt, event.timezone)}`,
														})}`
													: message,
											ok: true,
										},
							)
							await router.invalidate()
						}}
					/>
				)}
			</Dialog>

			<PassCards
				passes={page.passes}
				account={page.account}
				hasLink={Boolean(me)}
				eventPath={`/${org}/${eventSlug}`}
			/>

			{rankingMode &&
				!page.published &&
				tab === 'programme' &&
				(me ? (
					rankingOpen ? (
						<RankList
							draftKey={`ranking-draft:${event.id}`}
							sessions={event.sessionsPerParticipant}
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
									description: w.description,
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
				) : null)}

			{tab === 'myday' && me ? (
				mine.length === 0 && !(bookingMode && open) ? (
					<EmptyState
						icon={<CalendarDays />}
						title={rankingMode ? m.my_day_empty_ranking() : m.my_day_empty()}
					/>
				) : (
					<div className="flex flex-col gap-3">
						{bookingMode && open && mine.length < event.sessionsPerParticipant && (
							<p className="text-sm font-bold text-muted-foreground">
								{m.my_day_left({ count: String(event.sessionsPerParticipant - mine.length) })}
							</p>
						)}
						<DayStrip
							openSlots={
								bookingMode && open && mine.length < event.sessionsPerParticipant ? openSlots : []
							}
							onBrowse={() => setTab('programme')}
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
					</div>
				)
			) : null}
			{tab === 'myday' && me?.explanation && (
				<Explanation trace={me.explanation} titleOf={(id) => workshopById.get(id)?.title ?? ''} />
			)}
			{tab === 'myday' && me ? null : (
				<section
					id="programme-list"
					aria-labelledby="programme"
					className="flex scroll-mt-4 flex-col gap-4"
				>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<h2 id="programme" className="font-display text-xl font-semibold">
							{m.programme_title()}
						</h2>
						{bookingMode && me && open && (
							<label className="flex cursor-pointer items-center gap-2 text-sm font-bold">
								<input
									type="checkbox"
									className="size-4 accent-[var(--kelp)]"
									checked={availableOnly}
									onChange={(e) => setAvailableOnly(e.target.checked)}
								/>
								{m.available_only()}
							</label>
						)}
					</div>
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
							className="sticky top-0 z-10 flex h-[3.25rem] items-center gap-2 overflow-x-auto border-b border-border bg-background [scrollbar-width:none]"
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
							{groupBySlot(day.items.filter(shown)).map((slot, slotIndex) => (
								<details
									key={slot.startsAt.getTime()}
									open={
										slotIndex === 0 ||
										slot.items.some((s) => booked.has(s.id) || waitlisted.has(s.id))
									}
									className="group/slot flex flex-col"
								>
									<summary className="sticky top-[3.25rem] z-[5] -mx-2 flex min-h-10 cursor-pointer list-none items-center gap-3 rounded-lg bg-background px-2 hover:bg-accent [&::-webkit-details-marker]:hidden">
										<span className="font-bold tabular-nums">
											{formatTime(slot.startsAt, event.timezone)}–
											{formatTime(slot.endsAt, event.timezone)}
										</span>
										<span className="text-sm text-muted-foreground">
											{sessionCount(slot.items.length)}
										</span>
										<span
											aria-hidden
											className="min-w-0 flex-1 truncate text-sm text-muted-foreground group-open/slot:hidden"
										>
											{slot.items
												.slice(0, 3)
												.map((s) => workshopById.get(s.workshopId)?.title)
												.filter(Boolean)
												.join(', ')}
											{slot.items.length > 3 &&
												` ${m.slot_preview_more({ count: String(slot.items.length - 3) })}`}
										</span>
										<ChevronDown
											aria-hidden
											className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-open/slot:rotate-180"
										/>
									</summary>
									<ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl bg-card shadow-card">
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
														me &&
															state &&
															state.action === null &&
															'[&_.session-name]:font-medium [&_.session-name]:text-muted-foreground [&_.session-title>svg]:[fill-opacity:0.3]',
													)}
												>
													<div className="session-title flex flex-1 items-start gap-3">
														<Marker
															color={workshop.markerColor}
															shape={workshop.markerShape}
															className="mt-0.5"
														/>
														<div className="flex-1">
															<p className="flex flex-wrap items-center gap-x-2 gap-y-1">
																<span className="session-name font-bold" lang={event.defaultLocale}>
																	{workshop.title}
																</span>
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
																	{workshop.ageGroups.length > 0 && (
																		<span
																			className="font-bold text-foreground"
																			lang={event.defaultLocale}
																		>
																			{m.for_ages({ groups: workshop.ageGroups.join(', ') })} ·{' '}
																		</span>
																	)}
																	{state ? (
																		<span
																			className={cn(state.scarce && 'font-bold text-destructive')}
																		>
																			{state.text}
																		</span>
																	) : (
																		m.places({ count: String(session.capacity) })
																	)}
																</span>
															</p>
															{!bookingMode && workshop.description && (
																<p className="mt-1 line-clamp-2 text-sm" lang={event.defaultLocale}>
																	{workshop.description}
																</p>
															)}
														</div>
													</div>
													{open && state?.action === 'book' && (
														<Button
															size="sm"
															className="shrink-0 border-primary/70 text-primary hover:bg-tint-success hover:text-primary"
															variant="outline"
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
															<Plus />
															{m.book_short()}
														</Button>
													)}
													{open && state?.action === 'cancel' && (
														<Button
															size="sm"
															className="shrink-0"
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
															className="shrink-0"
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
															className="shrink-0"
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
								</details>
							))}
						</div>
					))}
				</section>
			)}
			{me && (
				<Button
					variant="ghost"
					size="sm"
					className="h-auto self-start px-0 text-muted-foreground hover:bg-transparent hover:text-destructive lg:hidden"
					onClick={() => router.navigate({ to: '.', search: { cancel: true } })}
				>
					{m.cancel_registration()}
				</Button>
			)}
		</Shell>
	)
}

/**
 * Header and outer layout shared by every state of the page. With an `aside`
 * (register and returning-participant actions), wide screens get a sticky
 * left rail beside the programme.
 */
function Shell({
	page,
	aside,
	children,
}: {
	page: Page
	aside?: React.ReactNode
	children: React.ReactNode
}) {
	const { event } = page
	return (
		<div className="min-h-dvh">
			<div className="h-1.5" style={{ background: event.accentColor ?? 'var(--kelp)' }} />
			<div
				className={cn(
					'mx-auto flex flex-col gap-6 px-4 pt-4 pb-10',
					aside ? 'max-w-5xl' : 'max-w-2xl',
				)}
			>
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
						className="font-display text-[clamp(1.875rem,6vw,2.75rem)] leading-[1.1] font-semibold text-balance wrap-break-word"
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
					{event.description && (
						<p lang={event.defaultLocale} className="whitespace-pre-line">
							{event.description}
						</p>
					)}
				</header>
				<div
					className={cn(
						'flex flex-col gap-6',
						aside && 'lg:grid lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start lg:gap-8',
					)}
				>
					{aside && <aside className="flex flex-col gap-3 lg:sticky lg:top-6">{aside}</aside>}
					<main className="flex min-w-0 flex-col gap-6">{children}</main>
				</div>
			</div>
		</div>
	)
}
