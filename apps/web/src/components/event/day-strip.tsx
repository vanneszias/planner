import { Button } from '@app/ui/components/button'
import { Marker, type MarkerColor, type MarkerShape } from '@app/ui/components/marker'
import { cn } from 'cn'
import { formatTime, groupByDay } from '#/lib/format'
import { m } from '#/paraglide/messages'

export type StripSession = {
	id: string
	startsAt: Date
	endsAt: Date
	room: string | null
	title: string
	markerColor: MarkerColor
	markerShape: MarkerShape
}

/** A time slot of the programme with nothing booked in it (booking mode). */
export type OpenSlot = { startsAt: Date; endsAt: Date }

/** Gaps shorter than this are walking time, not free time. */
const freeTimeMinutes = 30

/**
 * The day strip (design-system.md): one ticket-like strip per day, a segment
 * per session separated by perforations, and gaps shown as free time.
 */
export function DayStrip({
	sessions,
	openSlots = [],
	onBrowse,
	timeZone,
	contentLocale,
}: {
	sessions: StripSession[]
	/** Slots still free to book: shown as prompts instead of plain free time. */
	openSlots?: OpenSlot[]
	onBrowse?: () => void
	timeZone: string
	contentLocale: string
}) {
	type Item = StripSession | (OpenSlot & { id: string; open: true })
	const sorted: Item[] = [
		...sessions,
		...openSlots.map((slot) => ({
			...slot,
			id: `open-${slot.startsAt.getTime()}`,
			open: true as const,
		})),
	].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
	return (
		<div className="flex flex-col gap-6">
			{groupByDay(sorted, timeZone).map((day) => (
				<section key={day.label} aria-label={day.label} className="flex flex-col gap-2">
					<h3 className="font-display text-lg font-semibold first-letter:uppercase">{day.label}</h3>
					<ol className="overflow-hidden rounded-2xl bg-card shadow-card">
						{day.items.flatMap((session, index) => {
							const previous = day.items[index - 1]
							const gap = previous
								? (session.startsAt.getTime() - previous.endsAt.getTime()) / 60_000
								: 0
							const segments = []
							if (previous && gap >= freeTimeMinutes) {
								segments.push(
									<Segment
										key={`free-${session.id}`}
										time={formatTime(previous.endsAt, timeZone)}
										muted
									>
										<p className="text-muted-foreground">{m.free_time()}</p>
									</Segment>,
								)
							}
							if ('open' in session) {
								segments.push(
									<Segment key={session.id} time={formatTime(session.startsAt, timeZone)} muted>
										<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
											<p className="text-sm text-muted-foreground">
												{m.open_slot()} ·{' '}
												{m.until_time({ time: formatTime(session.endsAt, timeZone) })}
											</p>
											{onBrowse && (
												<Button
													variant="link"
													size="sm"
													className="h-auto px-0 text-sm"
													onClick={onBrowse}
												>
													{m.open_slot_choose()}
												</Button>
											)}
										</div>
									</Segment>,
								)
								return segments
							}
							segments.push(
								<Segment key={session.id} time={formatTime(session.startsAt, timeZone)}>
									<div className="flex items-start gap-3">
										<Marker
											color={session.markerColor}
											shape={session.markerShape}
											className="mt-0.5"
										/>
										<div>
											<p className="font-bold" lang={contentLocale}>
												{session.title}
											</p>
											<p className="text-sm text-muted-foreground">
												{session.room ? `${session.room} · ` : ''}
												{m.until_time({ time: formatTime(session.endsAt, timeZone) })}
											</p>
										</div>
									</div>
								</Segment>,
							)
							return segments
						})}
					</ol>
				</section>
			))}
		</div>
	)
}

/** One perforated segment: dashed divider with notches at both edges, except the first. */
function Segment({
	time,
	muted = false,
	children,
}: {
	time: string
	muted?: boolean
	children: React.ReactNode
}) {
	return (
		<li
			className={cn(
				'relative flex gap-4 p-4 [&+&]:border-t-[1.5px] [&+&]:border-dashed [&+&]:border-line [&+&]:before:absolute [&+&]:before:-top-2 [&+&]:before:-left-2 [&+&]:before:size-4 [&+&]:before:rounded-full [&+&]:before:bg-background [&+&]:after:absolute [&+&]:after:-top-2 [&+&]:after:-right-2 [&+&]:after:size-4 [&+&]:after:rounded-full [&+&]:after:bg-background',
				muted && 'py-2.5',
			)}
		>
			<span
				className={cn('w-12 shrink-0 tabular-nums', muted ? 'text-muted-foreground' : 'font-bold')}
			>
				{time}
			</span>
			<div className="flex-1">{children}</div>
		</li>
	)
}
