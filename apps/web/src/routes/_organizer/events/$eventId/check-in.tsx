import type { CheckInResult, RosterEntry } from '@app/domain'
import { Button } from '@app/ui/components/button'
import { Marker } from '@app/ui/components/marker'
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { cn } from 'cn'
import { Check, Printer, ScanLine, TriangleAlert, Users, X } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FormError } from '#/components/auth-shell'
import {
	isOffline,
	type QueuedScan,
	readQueue,
	writeQueue,
} from '#/components/check-in/offline-queue'
import { Scanner } from '#/components/check-in/scanner'
import { useLiveCheckIns } from '#/components/check-in/use-live-check-ins'
import { Field, FieldInput, FieldSelect } from '#/components/field'
import { EmptyState } from '#/components/page'
import { actionMessage } from '#/lib/errors'
import { formatShortDayTime, formatTime } from '#/lib/format'
import { m } from '#/paraglide/messages'
import { checkInFn, getCheckInFn, getRosterFn, undoCheckInFn } from '#/server/event-day'

export const Route = createFileRoute('/_organizer/events/$eventId/check-in')({
	loader: ({ params }) => getCheckInFn({ data: params.eventId }),
	component: CheckIn,
})
const eventRoute = getRouteApi('/_organizer/events/$eventId')

type Page = Awaited<ReturnType<typeof getCheckInFn>>
type Session = Page['sessions'][number]
type Request = { sessionId: string | null; scan?: string; registrationId?: string }
type Shown =
	| { kind: 'result'; result: CheckInResult; request: Request }
	| { kind: 'queued' }
	| { kind: 'undone'; name: string }
	| { kind: 'error'; message: string }

const wholeEvent = 'event'

/** The session starting nearest to now (journeys.md, O8 step 1). */
function nearest(sessions: Session[], now: number): Session | undefined {
	return [...sessions].sort((a, b) => Math.abs(a.startsAt - now) - Math.abs(b.startsAt - now))[0]
}

const fold = (text: string) =>
	text
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()

/** Event day check-in (journeys.md, O8), designed for a phone at the door. */
function CheckIn() {
	const page = Route.useLoaderData()
	const { event } = eventRoute.useLoaderData()
	const counts = useLiveCheckIns(event.id, page.counts)
	const [selected, setSelected] = useState(
		() => nearest(page.sessions, Date.now())?.id ?? wholeEvent,
	)
	const sessionId = selected === wholeEvent ? null : selected
	const session = page.sessions.find((s) => s.id === sessionId)
	const [scanning, setScanning] = useState(false)
	const [code, setCode] = useState('')
	const [shown, setShown] = useState<Shown | null>(null)
	const [pending, setPending] = useState(false)
	const [roster, setRoster] = useState<RosterEntry[] | null>(null)
	const [query, setQuery] = useState('')
	const [queued, setQueued] = useState<QueuedScan[]>([])
	const time = (at: number) => formatTime(new Date(at), page.timezone)

	const here = session ? (counts.sessions[session.id]?.here ?? 0) : counts.event.here
	const expected = session ? (counts.sessions[session.id]?.booked ?? 0) : counts.event.registered

	const loadRoster = useCallback(async () => {
		setRoster(await getRosterFn({ data: { eventId: event.id, sessionId } }))
	}, [event.id, sessionId])

	async function send(request: Request, force = false) {
		if (pending) return
		// Cleared first, so the same result twice is announced twice.
		setShown(null)
		setPending(true)
		try {
			const result = await checkInFn({ data: { eventId: event.id, ...request, force } })
			if (!result.ok) return setShown({ kind: 'error', message: actionMessage(result) })
			setShown({ kind: 'result', result: result.data, request })
			if (result.data.ok && result.data.status === 'checked_in') navigator.vibrate?.(60)
			if (roster) await loadRoster()
		} catch (error) {
			if (!isOffline(error)) throw error
			const next = [...readQueue(event.id), { ...request, at: Date.now() }]
			writeQueue(event.id, next)
			setQueued(next)
			setShown({ kind: 'queued' })
		} finally {
			setPending(false)
		}
	}

	// Sends scans saved while offline once the connection is back.
	const flush = useCallback(async () => {
		const waiting = readQueue(event.id)
		setQueued(waiting)
		if (waiting.length === 0 || !navigator.onLine) return
		const left: QueuedScan[] = []
		let refused = 0
		for (const item of waiting) {
			try {
				const result = await checkInFn({ data: { eventId: event.id, ...item } })
				if (!result.ok || !result.data.ok) refused++
			} catch (error) {
				if (!isOffline(error)) throw error
				left.push(item)
			}
		}
		writeQueue(event.id, left)
		setQueued(left)
		// Saved scans that didn't check anyone in need a look by name.
		if (refused > 0) {
			setShown({ kind: 'error', message: m.checkin_queue_refused({ count: String(refused) }) })
		}
	}, [event.id])

	useEffect(() => {
		flush()
		const timer = setInterval(flush, 15_000)
		window.addEventListener('online', flush)
		return () => {
			clearInterval(timer)
			window.removeEventListener('online', flush)
		}
	}, [flush])

	async function submitCode(e: FormEvent) {
		e.preventDefault()
		if (!code.trim()) return
		await send({ sessionId, scan: code })
		setCode('')
	}

	async function undo(registrationId: string, name: string) {
		const result = await undoCheckInFn({ data: { eventId: event.id, sessionId, registrationId } })
		if (!result.ok) return setShown({ kind: 'error', message: actionMessage(result) })
		focusLater(`[data-checkin="${registrationId}"]`)
		setShown({ kind: 'undone', name })
		if (roster) await loadRoster()
	}

	/**
	 * Focus goes where the control now is (the person's other button, the
	 * search field), once the next render has put it there.
	 */
	const focusTarget = useRef<string | null>(null)
	const focusLater = (selector: string) => {
		focusTarget.current = selector
		setTimeout(() => {
			focusTarget.current = null
		}, 1000)
	}
	// Kept for a second, since the row's button may be replaced more than once.
	useEffect(() => {
		const target = focusTarget.current && document.querySelector<HTMLElement>(focusTarget.current)
		if (target && document.activeElement !== target) target.focus()
	})

	const matches = useMemo(() => {
		if (!roster) return []
		const q = fold(query.trim())
		return q ? roster.filter((r) => fold(r.name).includes(q)) : roster
	}, [roster, query])

	return (
		<div className="flex flex-col gap-6">
			<div className="grid gap-4 rounded-xl bg-card p-5 shadow-card sm:grid-cols-[1fr_auto] sm:items-end print:hidden">
				<Field id="checkin-session" label={m.checkin_session_label()}>
					<FieldSelect
						id="checkin-session"
						value={selected}
						onChange={(e) => {
							setSelected(e.target.value)
							// A different session means a different list.
							setRoster(null)
							setShown(null)
						}}
					>
						<option value={wholeEvent}>{m.checkin_whole_event()}</option>
						{page.sessions.map((s) => (
							<option key={s.id} value={s.id}>
								{formatShortDayTime(new Date(s.startsAt), page.timezone)} · {s.workshopTitle}
								{s.room ? ` · ${s.room}` : ''}
							</option>
						))}
					</FieldSelect>
				</Field>
				<div className="flex min-w-56 flex-col gap-2">
					<p className="flex items-center gap-2.5">
						{session && <Marker color={session.markerColor} shape={session.markerShape} />}
						<span className="text-2xl font-bold tabular-nums">
							{m.checkin_counter({ here: String(here), expected: String(expected) })}
						</span>
					</p>
					<div className="h-2 overflow-hidden rounded-full bg-accent" aria-hidden>
						<div
							className="h-full rounded-full bg-success transition-[width]"
							style={{ width: `${expected ? Math.min(100, (here / expected) * 100) : 0}%` }}
						/>
					</div>
				</div>
			</div>

			{page.anonymised && <p className="rounded-xl bg-tint-warning p-4">{m.data_deleted()}</p>}
			{!page.canCheckIn && (
				<p className="rounded-xl bg-tint-warning p-4 print:hidden">{m.checkin_read_only()}</p>
			)}

			<div aria-live="polite" role="status" className="print:hidden">
				{shown && (
					<ScanResult
						shown={shown}
						session={session}
						time={time}
						pending={pending}
						onForce={(request) => send(request, true)}
						onUndo={(id) =>
							undo(id, shown.kind === 'result' && shown.result.ok ? shown.result.person.name : '')
						}
					/>
				)}
			</div>
			{queued.length > 0 && (
				<p className="rounded-xl bg-tint-warning p-4 font-bold print:hidden">
					{m.checkin_queued({ count: String(queued.length) })}
				</p>
			)}

			{page.canCheckIn && !page.anonymised && (
				<div className="flex flex-col gap-4 print:hidden">
					<div className="flex flex-wrap items-end gap-x-4 gap-y-3">
						<Button
							variant={scanning ? 'outline' : 'default'}
							onClick={() => setScanning(!scanning)}
						>
							{scanning ? <X /> : <ScanLine />}
							{scanning ? m.scanner_stop() : m.scanner_start()}
						</Button>
						<span className="pb-3 text-sm text-muted-foreground max-sm:hidden" aria-hidden>
							/
						</span>
						<form onSubmit={submitCode} noValidate className="flex flex-wrap items-end gap-2">
							<Field id="checkin-code" label={m.checkin_code_label()}>
								<FieldInput
									id="checkin-code"
									autoComplete="off"
									autoCapitalize="characters"
									spellCheck={false}
									placeholder="K7Q2-XA"
									className="max-w-48 font-mono uppercase"
									value={code}
									onChange={(e) => setCode(e.target.value)}
								/>
							</Field>
							<Button type="submit" variant="outline" aria-disabled={pending || undefined}>
								{m.checkin_submit()}
							</Button>
						</form>
					</div>
					{scanning && (
						<Scanner onScan={(text) => (pending ? undefined : send({ sessionId, scan: text }))} />
					)}
				</div>
			)}

			<section aria-labelledby="checkin-names" className="flex flex-col gap-3 print:hidden">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h2 id="checkin-names" className="font-display text-lg font-semibold">
						{m.checkin_by_name()}
					</h2>
					<Button
						variant="outline"
						size="sm"
						onClick={async () => {
							if (!roster) await loadRoster()
							// Let React render the list before the print dialog opens.
							setTimeout(() => window.print(), 50)
						}}
					>
						<Printer />
						{m.checkin_print()}
					</Button>
				</div>
				{roster ? (
					<>
						<Field id="checkin-search" label={m.checkin_search_label()}>
							<FieldInput
								id="checkin-search"
								type="search"
								autoComplete="off"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
							/>
						</Field>
						<p className="text-sm text-muted-foreground" aria-live="polite">
							{m.checkin_matches({ count: String(matches.length) })}
						</p>
						<ul className="flex flex-col divide-y divide-border rounded-xl bg-card shadow-card">
							{matches.slice(0, 50).map((person) => (
								<li key={person.registrationId} className="flex items-center gap-3 p-3">
									<span className="flex-1">
										<span className="block font-bold">{person.name || m.anonymous()}</span>
										{person.ageGroup && (
											<span className="text-sm text-muted-foreground">{person.ageGroup}</span>
										)}
									</span>
									{person.checkedInAt ? (
										<>
											<span className="text-sm font-bold">
												{m.checkin_here_at({ time: time(person.checkedInAt) })}
											</span>
											{page.canCheckIn && (
												<Button
													variant="ghost"
													className="px-2"
													data-checkin={person.registrationId}
													aria-label={m.checkin_undo_for({ name: person.name })}
													onClick={() => undo(person.registrationId, person.name)}
												>
													{m.checkin_undo()}
												</Button>
											)}
										</>
									) : (
										page.canCheckIn &&
										!page.anonymised && (
											<Button
												variant="outline"
												data-checkin={person.registrationId}
												aria-label={m.checkin_person({ name: person.name })}
												onClick={() => {
													focusLater(`[data-checkin="${person.registrationId}"]`)
													send({ sessionId, registrationId: person.registrationId })
												}}
											>
												{m.checkin_submit()}
											</Button>
										)
									)}
								</li>
							))}
						</ul>
					</>
				) : (
					<EmptyState
						icon={<Users />}
						title={m.checkin_names_hint()}
						action={
							<Button
								variant="outline"
								onClick={() => {
									focusLater('#checkin-search')
									loadRoster()
								}}
							>
								{m.checkin_show_names()}
							</Button>
						}
					/>
				)}
			</section>

			{roster && (
				<AttendanceSheet
					title={
						session
							? `${session.workshopTitle} · ${formatShortDayTime(new Date(session.startsAt), page.timezone)}${session.room ? ` · ${session.room}` : ''}`
							: m.checkin_whole_event()
					}
					eventName={event.name}
					roster={roster}
				/>
			)}
		</div>
	)
}

/** The last scan's result (design-system.md, `ScanResult`): big, with what to do next. */
function ScanResult({
	shown,
	session,
	time,
	pending,
	onForce,
	onUndo,
}: {
	shown: Shown
	session: Session | undefined
	time: (at: number) => string
	pending: boolean
	onForce: (request: Request) => void
	onUndo: (registrationId: string) => void
}) {
	if (shown.kind === 'queued') {
		return <p className="rounded-xl bg-tint-warning p-5 text-lg font-bold">{m.checkin_offline()}</p>
	}
	if (shown.kind === 'error') return <FormError message={shown.message} />
	if (shown.kind === 'undone') {
		return (
			<p className="rounded-xl bg-card shadow-card p-5 text-lg font-bold">
				{m.checkin_undone({ name: shown.name })}
			</p>
		)
	}
	const { result, request } = shown
	if (!result.ok && result.reason !== 'not_booked') {
		return (
			<p className="rounded-xl bg-tint-danger p-5 text-lg font-bold">
				{result.reason === 'session_not_found' ? m.error_not_found() : m.checkin_unknown()}
			</p>
		)
	}
	const tone = result.ok && result.status === 'checked_in' ? 'bg-tint-success' : 'bg-tint-warning'
	return (
		<div className={cn('flex flex-col gap-2 rounded-xl p-5', tone)}>
			<div className="flex items-center gap-3">
				{session && (
					<Marker color={session.markerColor} shape={session.markerShape} className="size-10" />
				)}
				<p className="font-display text-2xl font-semibold">{result.person.name}</p>
			</div>
			{result.person.ageGroup && <p>{result.person.ageGroup}</p>}
			{result.ok ? (
				<>
					<p className="text-lg font-bold">
						{result.status === 'checked_in' ? (
							<Check aria-hidden className="mr-1 inline size-5 align-[-3px]" strokeWidth={3} />
						) : (
							<TriangleAlert aria-hidden className="mr-1 inline size-5 align-[-3px]" />
						)}
						{result.status === 'checked_in'
							? m.checkin_done()
							: m.checkin_already({ time: time(result.at) })}
					</p>
					{result.status === 'checked_in' && (
						<div>
							<Button
								variant="ghost"
								className="px-2"
								onClick={() => onUndo(result.person.registrationId)}
							>
								{m.checkin_undo()}
							</Button>
						</div>
					)}
				</>
			) : (
				<>
					<p className="text-lg font-bold">
						<span aria-hidden="true">! </span>
						{m.checkin_not_booked()}
					</p>
					{result.bookedElsewhere && (
						<p>{m.checkin_booked_elsewhere({ workshop: result.bookedElsewhere })}</p>
					)}
					<div>
						<Button
							aria-disabled={pending || undefined}
							onClick={() =>
								onForce({
									...request,
									registrationId: result.person.registrationId,
									scan: undefined,
								})
							}
						>
							{m.checkin_anyway()}
						</Button>
					</div>
				</>
			)}
		</div>
	)
}

/** Printed attendance list (D17): the fallback when the venue has no signal. */
function AttendanceSheet({
	title,
	eventName,
	roster,
}: {
	title: string
	eventName: string
	roster: RosterEntry[]
}) {
	return (
		<div className="hidden print:block">
			<p className="text-sm">{eventName}</p>
			<h2 className="mb-3 text-xl font-bold">{title}</h2>
			<table className="w-full border-collapse text-left text-sm">
				<thead>
					<tr className="border-b-2 border-ink">
						<th className="w-10 p-2">{m.checkin_print_here()}</th>
						<th className="p-2">{m.column_name()}</th>
						<th className="p-2">{m.age_group_select()}</th>
					</tr>
				</thead>
				<tbody>
					{roster.map((person) => (
						<tr key={person.registrationId} className="break-inside-avoid border-b border-ink">
							<td className="p-2 text-lg">{person.checkedInAt ? '☑' : '☐'}</td>
							<td className="p-2">{person.name || m.anonymous()}</td>
							<td className="p-2">{person.ageGroup ?? ''}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}
