import type { CreateSessionsInput } from '@app/domain'
import { Button } from '@app/ui/components/button'
import { Marker } from '@app/ui/components/marker'
import { createFileRoute, getRouteApi, Link, useRouter } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { FormError } from '#/components/auth-shell'
import { Field, FieldInput } from '#/components/field'
import { actionMessage, fieldMessage } from '#/lib/errors'
import { formatTime, groupByDay } from '#/lib/format'
import { m } from '#/paraglide/messages'
import { createSessionsFn, deleteSessionFn } from '#/server/events'

export const Route = createFileRoute('/_organizer/events/$eventId/schedule')({
	component: Schedule,
})
const eventRoute = getRouteApi('/_organizer/events/$eventId')

function Schedule() {
	const { event, workshops, sessions, conflicts, canEdit } = eventRoute.useLoaderData()
	const router = useRouter()
	const [adding, setAdding] = useState(false)

	const titles = new Map(sessions.map((s) => [s.id, s.workshopTitle]))
	const conflictsOf = new Map<string, string[]>()
	for (const [a, b] of conflicts) {
		conflictsOf.set(a, [...(conflictsOf.get(a) ?? []), titles.get(b) ?? ''])
		conflictsOf.set(b, [...(conflictsOf.get(b) ?? []), titles.get(a) ?? ''])
	}

	async function remove(sessionId: string) {
		if (!window.confirm(m.delete_session_confirm())) return
		await deleteSessionFn({ data: sessionId })
		await router.invalidate()
	}

	if (workshops.length === 0) {
		return (
			<p className="rounded-xl bg-card p-6">
				<Link
					to="/events/$eventId/workshops"
					params={{ eventId: event.id }}
					className="font-bold text-primary underline underline-offset-4"
				>
					{m.schedule_needs_workshops()}
				</Link>
			</p>
		)
	}

	return (
		<div className="flex flex-col gap-6">
			{canEdit &&
				(adding ? (
					<AddSessionsForm
						onDone={async (saved) => {
							setAdding(false)
							if (saved) await router.invalidate()
						}}
					/>
				) : (
					<div>
						<Button onClick={() => setAdding(true)}>{m.add_sessions()}</Button>
					</div>
				))}

			{sessions.length === 0 && !adding && (
				<p className="rounded-xl bg-card p-6">{m.sessions_empty()}</p>
			)}

			{groupByDay(sessions, event.timezone).map((day) => (
				<section key={day.label} aria-label={day.label} className="flex flex-col gap-2">
					<h2 className="font-display text-lg font-medium first-letter:uppercase">{day.label}</h2>
					<ul className="flex flex-col gap-2">
						{day.items.map((session) => {
							const clashes = conflictsOf.get(session.id)
							return (
								<li key={session.id} className="flex flex-col gap-2 rounded-xl bg-card p-4">
									<div className="flex items-center justify-between gap-3">
										<span className="font-mono">
											{formatTime(session.startsAt, event.timezone)}–
											{formatTime(session.endsAt, event.timezone)}
										</span>
										{canEdit && (
											<Button
												variant="ghost"
												className="-my-2 px-2"
												aria-label={`${m.delete()}: ${session.workshopTitle} ${formatTime(session.startsAt, event.timezone)}`}
												onClick={() => remove(session.id)}
											>
												{m.delete()}
											</Button>
										)}
									</div>
									<div className="flex items-start gap-3">
										<Marker
											color={session.markerColor}
											shape={session.markerShape}
											className="mt-0.5"
										/>
										<div>
											<p className="font-bold">{session.workshopTitle}</p>
											<p className="text-sm text-muted-foreground">
												{session.room ?? m.no_room()} ·{' '}
												{m.places({ count: String(session.capacity) })}
											</p>
										</div>
									</div>
									{clashes?.map((other) => (
										<p
											key={other}
											className="rounded-md bg-tint-warning px-3 py-1 text-sm font-bold"
										>
											{m.room_conflict({ other })}
										</p>
									))}
								</li>
							)
						})}
					</ul>
				</section>
			))}
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
		<form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-xl bg-card p-5">
			<Field id="workshopId" label={m.workshop_label()} error={issues.workshopId}>
				<select
					id="workshopId"
					className="h-11 rounded-md border border-input bg-card px-3"
					value={workshopId}
					onChange={(e) => setWorkshopId(e.target.value)}
				>
					{workshops.map((workshop) => (
						<option key={workshop.id} value={workshop.id}>
							{workshop.title}
						</option>
					))}
				</select>
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
			<div className="flex gap-2">
				<Button type="submit" disabled={pending}>
					{m.save_sessions()}
				</Button>
				<Button type="button" variant="ghost" onClick={() => onDone(false)}>
					{m.cancel()}
				</Button>
			</div>
		</form>
	)
}
