import type { CreateSessionsInput } from '@app/domain'
import { utcToZoned } from '@app/domain/time'
import { Button } from '@app/ui/components/button'
import { ConfirmDialog, Dialog } from '@app/ui/components/dialog'
import { Marker } from '@app/ui/components/marker'
import { createFileRoute, getRouteApi, Link, useRouter } from '@tanstack/react-router'
import { CalendarClock, Plus, TriangleAlert } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { FormError } from '#/components/auth-shell'
import { Field, FieldInput, FieldSelect, FormActions } from '#/components/field'
import { EmptyState, PageToolbar, RowActions } from '#/components/page'
import { actionMessage, fieldMessage } from '#/lib/errors'
import { formatTime, groupByDay, groupBySlot } from '#/lib/format'
import { m } from '#/paraglide/messages'
import { createSessionsFn, deleteSessionFn, updateSessionFn } from '#/server/events'

export const Route = createFileRoute('/_organizer/events/$eventId/schedule')({
	component: Schedule,
})
const eventRoute = getRouteApi('/_organizer/events/$eventId')

function Schedule() {
	const { event, workshops, sessions, seats, conflicts, canEdit } = eventRoute.useLoaderData()
	const booking = event.mode === 'booking'
	const router = useRouter()
	const [adding, setAdding] = useState(false)
	const [editing, setEditing] = useState<SessionRow | null>(null)
	const [deleting, setDeleting] = useState<SessionRow | null>(null)

	const titles = new Map(sessions.map((s) => [s.id, s.workshopTitle]))
	const conflictsOf = new Map<string, string[]>()
	for (const [a, b] of conflicts) {
		conflictsOf.set(a, [...(conflictsOf.get(a) ?? []), titles.get(b) ?? ''])
		conflictsOf.set(b, [...(conflictsOf.get(b) ?? []), titles.get(a) ?? ''])
	}

	if (workshops.length === 0) {
		return (
			<EmptyState
				icon={<CalendarClock />}
				title={m.schedule_needs_workshops()}
				action={
					<Button asChild variant="outline">
						<Link to="/events/$eventId/workshops" params={{ eventId: event.id }}>
							{m.add_workshop()}
						</Link>
					</Button>
				}
			/>
		)
	}

	const days = groupByDay(sessions, event.timezone)
	return (
		<div className="flex flex-col gap-8">
			<PageToolbar
				summary={m.sessions_summary({
					sessions: String(sessions.length),
					days: String(days.length),
				})}
			>
				{canEdit && (
					<Button onClick={() => setAdding(true)}>
						<Plus />
						{m.add_sessions()}
					</Button>
				)}
			</PageToolbar>

			{sessions.length === 0 && <EmptyState icon={<CalendarClock />} title={m.sessions_empty()} />}

			{days.map((day) => (
				<section key={day.label} aria-label={day.label} className="flex flex-col gap-4">
					<h2 className="font-display text-xl font-semibold first-letter:uppercase">{day.label}</h2>
					{groupBySlot(day.items).map((slot) => (
						<div key={slot.startsAt.getTime()} className="flex flex-col gap-2">
							<h3 className="sticky top-14 z-10 -mx-1 flex items-baseline gap-3 bg-background/95 px-1 py-1.5 backdrop-blur">
								<span className="text-base font-bold tabular-nums">
									{formatTime(slot.startsAt, event.timezone)}–
									{formatTime(slot.endsAt, event.timezone)}
								</span>
								<span className="text-sm text-muted-foreground">
									{m.slot_count({ count: String(slot.items.length) })}
								</span>
							</h3>
							<ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
								{slot.items.map((session) => {
									const clashes = conflictsOf.get(session.id)
									const label = `${session.workshopTitle} ${formatTime(session.startsAt, event.timezone)}`
									return (
										<li
											key={session.id}
											className="group flex flex-col gap-2 rounded-lg bg-card py-3 pr-2 pl-3 shadow-card"
										>
											<div className="flex items-start gap-2.5">
												<Marker
													color={session.markerColor}
													shape={session.markerShape}
													className="mt-0.5"
												/>
												<div className="min-w-0 flex-1">
													<p className="truncate font-bold leading-snug">{session.workshopTitle}</p>
													<p className="text-sm text-muted-foreground">
														{session.room ?? m.no_room()} ·{' '}
														{booking
															? m.seats_taken({
																	taken: String(seats[session.id] ?? 0),
																	capacity: String(session.capacity),
																})
															: m.places({ count: String(session.capacity) })}
													</p>
													{booking && (
														<span
															className="mt-1.5 block h-1 overflow-hidden rounded-full bg-accent"
															aria-hidden
														>
															<span
																className="block h-full rounded-full bg-primary"
																style={{
																	width: `${Math.min(100, ((seats[session.id] ?? 0) / Math.max(1, session.capacity)) * 100)}%`,
																}}
															/>
														</span>
													)}
												</div>
												{canEdit && (
													<RowActions
														label={label}
														onEdit={() => setEditing(session)}
														onDelete={() => setDeleting(session)}
													/>
												)}
											</div>
											{clashes?.map((other) => (
												<p
													key={other}
													className="flex items-center gap-1.5 rounded-md bg-tint-warning px-2 py-1 text-sm font-bold"
												>
													<TriangleAlert className="size-4 shrink-0" aria-hidden />
													{m.room_conflict({ other })}
												</p>
											))}
										</li>
									)
								})}
							</ul>
						</div>
					))}
				</section>
			))}

			<Dialog
				open={adding}
				onOpenChange={setAdding}
				title={m.add_sessions()}
				closeLabel={m.close()}
			>
				<AddSessionsForm
					onDone={async (saved) => {
						setAdding(false)
						if (saved) await router.invalidate()
					}}
				/>
			</Dialog>
			<Dialog
				open={editing !== null}
				onOpenChange={(open) => !open && setEditing(null)}
				title={editing?.workshopTitle ?? m.edit_session_title()}
				description={m.edit_session_title()}
				icon={editing && <Marker color={editing.markerColor} shape={editing.markerShape} />}
				closeLabel={m.close()}
			>
				{editing && (
					<EditSessionForm
						session={editing}
						onDone={async (saved) => {
							setEditing(null)
							if (saved) await router.invalidate()
						}}
					/>
				)}
			</Dialog>
			<ConfirmDialog
				open={deleting !== null}
				onOpenChange={(open) => !open && setDeleting(null)}
				title={
					deleting
						? m.delete_session_title({
								title: deleting.workshopTitle,
								time: formatTime(deleting.startsAt, event.timezone),
							})
						: ''
				}
				description={m.cannot_undo()}
				confirmLabel={m.delete()}
				cancelLabel={m.cancel()}
				onConfirm={async () => {
					if (!deleting) return
					await deleteSessionFn({ data: deleting.id })
					setDeleting(null)
					await router.invalidate()
				}}
			/>
		</div>
	)
}

type Slot = CreateSessionsInput['slots'][number]

function AddSessionsForm({ onDone }: { onDone: (saved: boolean) => Promise<void> }) {
	const { event, workshops } = eventRoute.useLoaderData()
	const [workshopId, setWorkshopId] = useState(workshops[0]?.id ?? '')
	const [room, setRoom] = useState('')
	const [capacity, setCapacity] = useState(15)
	const [slots, setSlots] = useState<Slot[]>([
		{ date: event.startsOn, start: '10:00', end: '11:00' },
	])
	const [issues, setIssues] = useState<Record<string, string>>({})
	const [error, setError] = useState<string | null>(null)
	const [pending, setPending] = useState(false)

	const setSlot = (index: number, patch: Partial<Slot>) =>
		setSlots((all) => all.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)))

	async function submit(formEvent: FormEvent) {
		formEvent.preventDefault()
		setError(null)
		setPending(true)
		const result = await createSessionsFn({
			data: { eventId: event.id, values: { workshopId, room, capacity, slots } },
		})
		setPending(false)
		if (result.ok) return onDone(true)
		if (result.issues) setIssues(result.issues)
		else setError(actionMessage(result))
	}

	return (
		<form onSubmit={submit} noValidate className="flex flex-col gap-5">
			<Field id="workshopId" label={m.workshop_label()} error={issues.workshopId}>
				<FieldSelect
					id="workshopId"
					value={workshopId}
					onChange={(e) => setWorkshopId(e.target.value)}
				>
					{workshops.map((workshop) => (
						<option key={workshop.id} value={workshop.id}>
							{workshop.title}
						</option>
					))}
				</FieldSelect>
			</Field>
			<div className="grid gap-4 sm:grid-cols-2">
				<Field id="room" label={m.room_label()} error={issues.room}>
					<FieldInput
						id="room"
						error={issues.room}
						value={room}
						onChange={(e) => setRoom(e.target.value)}
					/>
				</Field>
				<Field id="capacity" label={m.capacity_label()} error={issues.capacity}>
					<FieldInput
						id="capacity"
						type="number"
						inputMode="numeric"
						min={0}
						error={issues.capacity}
						className="max-w-32"
						value={capacity}
						onChange={(e) => setCapacity(Number(e.target.value))}
					/>
				</Field>
			</div>

			<fieldset className="flex flex-col gap-3">
				<legend className="mb-2 font-bold">{m.times_label()}</legend>
				{slots.map((slot, index) => {
					const slotError =
						issues[`slots.${index}.date`] ??
						issues[`slots.${index}.start`] ??
						issues[`slots.${index}.end`]
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: slots have no identity beyond position
						<div key={index} className="flex flex-col gap-2 rounded-lg border border-border p-3">
							<div className="flex flex-wrap items-end gap-3">
								<Field id={`slot-${index}-date`} label={m.date_label()}>
									<FieldInput
										id={`slot-${index}-date`}
										type="date"
										min={event.startsOn}
										max={event.endsOn}
										value={slot.date}
										onChange={(e) => setSlot(index, { date: e.target.value })}
									/>
								</Field>
								<Field id={`slot-${index}-start`} label={m.start_label()}>
									<FieldInput
										id={`slot-${index}-start`}
										type="time"
										value={slot.start}
										onChange={(e) => setSlot(index, { start: e.target.value })}
									/>
								</Field>
								<Field id={`slot-${index}-end`} label={m.end_label()}>
									<FieldInput
										id={`slot-${index}-end`}
										type="time"
										value={slot.end}
										onChange={(e) => setSlot(index, { end: e.target.value })}
									/>
								</Field>
								{slots.length > 1 && (
									<Button
										type="button"
										variant="ghost"
										onClick={() => setSlots((all) => all.filter((_, i) => i !== index))}
									>
										{m.remove_time()}
									</Button>
								)}
							</div>
							{slotError && (
								<p className="text-sm font-bold text-destructive">{fieldMessage(slotError)}</p>
							)}
						</div>
					)
				})}
				<div>
					<Button
						type="button"
						variant="outline"
						onClick={() =>
							setSlots((all) => [
								...all,
								{ ...(all.at(-1) ?? { date: event.startsOn, start: '10:00', end: '11:00' }) },
							])
						}
					>
						{m.add_time()}
					</Button>
				</div>
			</fieldset>

			<FormError message={error} />
			<FormActions>
				<Button type="button" variant="outline" onClick={() => onDone(false)}>
					{m.cancel()}
				</Button>
				<Button type="submit" disabled={pending}>
					{m.save_sessions()}
				</Button>
			</FormActions>
		</form>
	)
}

type SessionRow = ReturnType<typeof eventRoute.useLoaderData>['sessions'][number]

/** Changes one session's time, room or places. Times are shown in the event's timezone. */
function EditSessionForm({
	session,
	onDone,
}: {
	session: SessionRow
	onDone: (saved: boolean) => Promise<void>
}) {
	const { event } = eventRoute.useLoaderData()
	const start = utcToZoned(session.startsAt, event.timezone)
	const [slot, setSlot] = useState<Slot>({
		date: start.date,
		start: start.time,
		end: utcToZoned(session.endsAt, event.timezone).time,
	})
	const [room, setRoom] = useState(session.room ?? '')
	const [capacity, setCapacity] = useState(session.capacity)
	const [issues, setIssues] = useState<Record<string, string>>({})
	const [error, setError] = useState<string | null>(null)
	const [pending, setPending] = useState(false)
	const id = `edit-${session.id}`

	async function submit(formEvent: FormEvent) {
		formEvent.preventDefault()
		setError(null)
		setPending(true)
		const result = await updateSessionFn({
			data: { sessionId: session.id, values: { room, capacity, slot } },
		})
		setPending(false)
		if (result.ok) return onDone(true)
		if (result.issues) setIssues(result.issues)
		else setError(actionMessage(result))
	}

	const slotError = issues['slot.date'] ?? issues['slot.end'] ?? issues['slots.0.date']
	return (
		<form onSubmit={submit} noValidate className="flex flex-col gap-5">
			<div className="flex flex-wrap items-end gap-3">
				<Field id={`${id}-date`} label={m.date_label()}>
					<FieldInput
						id={`${id}-date`}
						type="date"
						min={event.startsOn}
						max={event.endsOn}
						value={slot.date}
						onChange={(e) => setSlot({ ...slot, date: e.target.value })}
					/>
				</Field>
				<Field id={`${id}-start`} label={m.start_label()}>
					<FieldInput
						id={`${id}-start`}
						type="time"
						value={slot.start}
						onChange={(e) => setSlot({ ...slot, start: e.target.value })}
					/>
				</Field>
				<Field id={`${id}-end`} label={m.end_label()}>
					<FieldInput
						id={`${id}-end`}
						type="time"
						value={slot.end}
						onChange={(e) => setSlot({ ...slot, end: e.target.value })}
					/>
				</Field>
			</div>
			{slotError && <p className="text-sm font-bold text-destructive">{fieldMessage(slotError)}</p>}
			<div className="grid gap-4 sm:grid-cols-2">
				<Field id={`${id}-room`} label={m.room_label()} error={issues.room}>
					<FieldInput
						id={`${id}-room`}
						error={issues.room}
						value={room}
						onChange={(e) => setRoom(e.target.value)}
					/>
				</Field>
				<Field id={`${id}-capacity`} label={m.capacity_label()} error={issues.capacity}>
					<FieldInput
						id={`${id}-capacity`}
						type="number"
						inputMode="numeric"
						min={0}
						className="max-w-32"
						error={issues.capacity}
						value={capacity}
						onChange={(e) => setCapacity(Number(e.target.value))}
					/>
				</Field>
			</div>
			<FormError message={error} />
			<FormActions>
				<Button type="button" variant="outline" onClick={() => onDone(false)}>
					{m.cancel()}
				</Button>
				<Button type="submit" disabled={pending}>
					{m.save_session()}
				</Button>
			</FormActions>
		</form>
	)
}
