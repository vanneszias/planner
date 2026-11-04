import {
	type Availability,
	cellTallies,
	type Mark,
	minutesToTime,
	type PollShape,
	pollCells,
	pollDates,
	type RankedWindow,
	rowMinutes,
} from '@app/domain/poll-grid'
import { Button } from '@app/ui/components/button'
import { cn } from 'cn'
import { useEffect, useMemo, useRef, useState } from 'react'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'

/*
 * The availability grid (docs/availability-polls.md): days across, 30-minute
 * rows down. PaintGrid is where someone marks their own time; HeatGrid shows
 * everyone's together. Both scroll sideways inside themselves on phones.
 */

const lang = () => (getLocale() === 'nl' ? 'nl-BE' : 'en-GB')

/** "Tue 12 Nov" for a grid date (YYYY-MM-DD, no timezone shift). */
export function formatGridDay(date: string, long = false): string {
	return new Intl.DateTimeFormat(lang(), {
		weekday: long ? 'long' : 'short',
		day: 'numeric',
		month: long ? 'long' : 'short',
		timeZone: 'UTC',
	}).format(new Date(`${date}T12:00:00Z`))
}

/** "Tuesday 12 November, 19:30–21:30" in the poll's timezone. */
export function formatWindow(startsAt: number, endsAt: number, timeZone: string): string {
	const day = new Intl.DateTimeFormat(lang(), {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		timeZone,
	}).format(startsAt)
	const time = new Intl.DateTimeFormat(lang(), {
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
		timeZone,
	})
	return `${day}, ${time.format(startsAt)}–${time.format(endsAt)}`
}

function useLayout(shape: PollShape) {
	return useMemo(() => {
		const dates = pollDates(shape)
		const rows = rowMinutes(shape)
		const cells = new Map<string, number>()
		for (const cell of pollCells(shape)) cells.set(`${cell.date} ${cell.minutes}`, cell.startsAt)
		const at = (date: string, minutes: number) => cells.get(`${date} ${minutes}`) as number
		return { dates, rows, at }
	}, [shape])
}

function GridFrame({
	shape,
	children,
	onPointerMove,
}: {
	shape: PollShape
	children: (date: string, minutes: number, startsAt: number) => React.ReactNode
	onPointerMove?: (event: React.PointerEvent) => void
}) {
	const { dates, rows, at } = useLayout(shape)
	return (
		<div className="overflow-x-auto rounded-xl border border-border bg-card">
			<table className="border-separate border-spacing-0.5 p-1" onPointerMove={onPointerMove}>
				<thead>
					<tr>
						<th className="sticky left-0 z-10 bg-card" aria-hidden />
						{dates.map((date) => (
							<th
								key={date}
								scope="col"
								className="min-w-12 px-1 pb-1 text-center text-xs leading-tight font-bold"
							>
								{formatGridDay(date)
									.split(' ')
									.map((part) => (
										<span key={part} className="block">
											{part}
										</span>
									))}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((minutes) => (
						<tr key={minutes}>
							<th
								scope="row"
								className="sticky left-0 z-10 bg-card pr-1 text-right align-top text-xs font-normal text-muted-foreground tabular-nums"
							>
								{minutes % 60 === 0 ? minutesToTime(minutes) : ''}
							</th>
							{dates.map((date) => (
								<td key={date} className="p-0">
									{children(date, minutes, at(date, minutes))}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

const markLabel = (mark: Mark | undefined) =>
	mark === 'free'
		? m.poll_mark_free()
		: mark === 'ifNeeded'
			? m.poll_mark_if_needed()
			: m.poll_mark_none()

export type Brush = Mark | 'erase'

export function toMarks(availability: Availability): Map<number, Mark> {
	const marks = new Map<number, Mark>()
	for (const t of availability.ifNeeded) marks.set(t, 'ifNeeded')
	for (const t of availability.free) marks.set(t, 'free')
	return marks
}

export function fromMarks(marks: Map<number, Mark>): Availability {
	const free: number[] = []
	const ifNeeded: number[] = []
	for (const [t, mark] of marks) (mark === 'free' ? free : ifNeeded).push(t)
	return { free, ifNeeded }
}

/**
 * Press a cell and drag to paint with the brush. Pressing a cell that already
 * has the brush's mark erases instead, so a second drag undoes the first.
 * Keyboard: each cell is a button that cycles free → if needed → empty.
 */
export function PaintGrid({
	shape,
	marks,
	brush,
	onChange,
	disabled,
}: {
	shape: PollShape
	marks: Map<number, Mark>
	brush: Brush
	onChange: (marks: Map<number, Mark>) => void
	disabled?: boolean
}) {
	const painting = useRef<{ value: Mark | null; marks: Map<number, Mark> } | null>(null)
	useEffect(() => {
		const stop = () => {
			painting.current = null
		}
		window.addEventListener('pointerup', stop)
		window.addEventListener('pointercancel', stop)
		return () => {
			window.removeEventListener('pointerup', stop)
			window.removeEventListener('pointercancel', stop)
		}
	}, [])

	const paint = (startsAt: number) => {
		const current = painting.current
		if (!current || current.marks.get(startsAt) === (current.value ?? undefined)) return
		const next = new Map(current.marks)
		if (current.value) next.set(startsAt, current.value)
		else next.delete(startsAt)
		current.marks = next
		onChange(next)
	}

	const start = (event: React.PointerEvent, startsAt: number) => {
		if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return
		event.preventDefault()
		// Release the implicit touch capture, so moving over other cells reaches them.
		;(event.target as Element).releasePointerCapture?.(event.pointerId)
		const value = brush === 'erase' || marks.get(startsAt) === brush ? null : brush
		painting.current = { value, marks }
		paint(startsAt)
	}

	const move = (event: React.PointerEvent) => {
		if (!painting.current) return
		const cell = document
			.elementFromPoint(event.clientX, event.clientY)
			?.closest<HTMLElement>('[data-cell]')
		if (cell) paint(Number(cell.dataset.cell))
	}

	const cycle = (startsAt: number) => {
		const next = new Map(marks)
		const mark = marks.get(startsAt)
		if (!mark) next.set(startsAt, 'free')
		else if (mark === 'free') next.set(startsAt, 'ifNeeded')
		else next.delete(startsAt)
		onChange(next)
	}

	return (
		// min-w-0: a fieldset is min-content wide by default, which would stop the grid scrolling.
		<fieldset aria-label={m.poll_grid_label()} className="min-w-0">
			<GridFrame shape={shape} onPointerMove={move}>
				{(date, minutes, startsAt) => {
					const mark = marks.get(startsAt)
					return (
						<button
							type="button"
							data-cell={startsAt}
							disabled={disabled}
							aria-label={`${formatGridDay(date, true)} ${minutesToTime(minutes)}: ${markLabel(mark)}`}
							onPointerDown={(event) => start(event, startsAt)}
							// Pointer presses paint on pointerdown; this handles keyboard presses only.
							onClick={(event) => event.detail === 0 && cycle(startsAt)}
							className={cn(
								'block h-7 w-full min-w-12 touch-none rounded-sm border select-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed',
								minutes % 60 === 0 ? 'border-input' : 'border-line',
								mark === 'free' && 'border-primary bg-primary',
								mark === 'ifNeeded' &&
									'border-primary bg-tint-success bg-[repeating-linear-gradient(135deg,transparent_0_4px,color-mix(in_srgb,var(--kelp)_45%,transparent)_4px_6px)]',
							)}
						/>
					)
				}}
			</GridFrame>
		</fieldset>
	)
}

export type NamedRespondent = { id: string; name: string | null; availability: Availability }

/**
 * Everyone's availability together: darker means more people. The count is
 * written in each cell, so colour is never the only signal. Selecting a cell
 * lists who is free then (or counts, when names are hidden).
 */
export function HeatGrid({
	shape,
	respondents,
	highlight,
}: {
	shape: PollShape
	respondents: readonly NamedRespondent[]
	/** A window to outline, such as the confirmed time. */
	highlight?: { startsAt: number; endsAt: number } | null
}) {
	const tallies = useMemo(
		() => cellTallies(respondents.map((r) => ({ ...r, name: r.name ?? '' }))),
		[respondents],
	)
	const names = useMemo(() => new Map(respondents.map((r) => [r.id, r.name])), [respondents])
	const [selected, setSelected] = useState<{
		date: string
		minutes: number
		startsAt: number
	} | null>(null)
	const total = respondents.length
	const detail = selected ? tallies.get(selected.startsAt) : undefined
	const list = (ids: string[] = []) => {
		const shown = ids.map((id) => names.get(id)).filter((n): n is string => Boolean(n))
		return shown.length === ids.length ? shown.join(', ') : String(ids.length)
	}

	return (
		<div className="flex flex-col gap-3">
			<GridFrame shape={shape}>
				{(date, minutes, startsAt) => {
					const tally = tallies.get(startsAt)
					const free = tally?.free.length ?? 0
					const maybe = tally?.ifNeeded.length ?? 0
					const share = total ? (free + maybe / 2) / total : 0
					const inHighlight =
						highlight && startsAt >= highlight.startsAt && startsAt < highlight.endsAt
					return (
						<button
							type="button"
							aria-label={`${formatGridDay(date, true)} ${minutesToTime(minutes)}: ${m.poll_cell_summary({ free: String(free), maybe: String(maybe) })}`}
							aria-pressed={selected?.startsAt === startsAt}
							onClick={() => setSelected({ date, minutes, startsAt })}
							style={{
								backgroundColor: `color-mix(in srgb, var(--kelp) ${Math.round(share * 100)}%, var(--card))`,
							}}
							className={cn(
								'block h-7 w-full min-w-12 rounded-sm border border-line text-xs font-bold tabular-nums',
								share > 0.5 ? 'text-primary-foreground' : 'text-foreground',
								inHighlight && 'outline-3 -outline-offset-1 outline-marker-sun',
								selected?.startsAt === startsAt && 'ring-2 ring-ring ring-offset-1',
							)}
						>
							{free + maybe > 0 ? free + maybe : ''}
						</button>
					)
				}}
			</GridFrame>
			<p aria-live="polite" className="min-h-6 text-sm">
				{selected &&
					(detail
						? `${formatGridDay(selected.date, true)} ${minutesToTime(selected.minutes)}. ${m.poll_detail_free({ names: list(detail.free) || '0' })}${detail.ifNeeded.length ? ` ${m.poll_detail_if_needed({ names: list(detail.ifNeeded) })}` : ''}`
						: `${formatGridDay(selected.date, true)} ${minutesToTime(selected.minutes)}. ${m.poll_detail_nobody()}`)}
			</p>
		</div>
	)
}

/** The best start times, as a list. Organizers get a confirm button on each. */
export function BestTimes({
	windows,
	timezone,
	names,
	onConfirm,
	busy,
}: {
	windows: RankedWindow[]
	timezone: string
	names: Map<string, string | null>
	onConfirm?: (startsAt: number) => void
	busy?: boolean
}) {
	const shown = windows.filter((w) => w.free.length + w.ifNeeded.length > 0).slice(0, 5)
	if (shown.length === 0) return <p className="text-muted-foreground">{m.poll_no_overlap()}</p>
	const who = (ids: string[]) => {
		const list = ids.map((id) => names.get(id)).filter((n): n is string => Boolean(n))
		return list.length === ids.length ? list.join(', ') : ''
	}
	return (
		<ol className="flex flex-col gap-2">
			{shown.map((w, i) => (
				<li
					key={w.startsAt}
					className={cn(
						'flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3',
						i === 0 ? 'border-primary bg-tint-success' : 'border-border bg-card',
					)}
				>
					<div>
						<p className="font-bold">{formatWindow(w.startsAt, w.endsAt, timezone)}</p>
						<p className="text-sm">
							{m.poll_window_count({
								count: String(w.free.length + w.ifNeeded.length),
							})}
							{w.ifNeeded.length > 0 &&
								` ${m.poll_window_if_needed({ count: String(w.ifNeeded.length) })}`}
						</p>
						{who([...w.free, ...w.ifNeeded]) && (
							<p className="text-sm text-muted-foreground">
								{[
									w.free.length > 0 && who(w.free),
									w.ifNeeded.length > 0 && `${m.poll_mark_if_needed()}: ${who(w.ifNeeded)}`,
								]
									.filter(Boolean)
									.join(' · ')}
							</p>
						)}
					</div>
					{onConfirm && (
						<Button disabled={busy} onClick={() => onConfirm(w.startsAt)}>
							{m.poll_confirm_time()}
						</Button>
					)}
				</li>
			))}
		</ol>
	)
}
