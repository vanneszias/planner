import type { Workshop } from '@app/domain'
import { Button } from '@app/ui/components/button'
import { Marker } from '@app/ui/components/marker'
import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { FormError } from '#/components/auth-shell'
import { Explanation } from '#/components/event/explanation'
import { RadioCards } from '#/components/radio-cards'
import { actionMessage } from '#/lib/errors'
import { formatShortDayTime } from '#/lib/format'
import { m } from '#/paraglide/messages'
import {
	fillEmptyFn,
	getAllocationFn,
	moveFn,
	publishFn,
	publishPreviewFn,
	runDraftFn,
} from '#/server/allocation'

export const Route = createFileRoute('/_organizer/events/$eventId/allocation')({
	loader: ({ params }) => getAllocationFn({ data: params.eventId }),
	component: Allocation,
})
const eventRoute = getRouteApi('/_organizer/events/$eventId')

type Review = NonNullable<Awaited<ReturnType<typeof getAllocationFn>>['review']>
type Person = Review['people'][number]
type WorkshopLook = Pick<Workshop, 'title' | 'markerColor' | 'markerShape'>

const moveErrors: Record<string, () => string> = {
	full: m.move_full,
	overlap: m.move_overlap,
	same_workshop: m.move_same_workshop,
	not_eligible: m.move_not_eligible,
}

/** Draft, review, adjust and publish (journeys.md, O6). */
function Allocation() {
	const { progress, review, names } = Route.useLoaderData()
	const { event, workshops, sessions, canPublish, canEdit } = eventRoute.useLoaderData()
	const router = useRouter()
	const [strategy, setStrategy] = useState(event.allocationStrategy)
	const [filter, setFilter] = useState<'all' | 'empty' | 'notop3'>('all')
	const [open, setOpen] = useState<string | null>(null)
	const [confirm, setConfirm] = useState<{ firstPublish: boolean; peopleChanging: number } | null>(
		null,
	)
	const [status, setStatus] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [pending, setPending] = useState(false)

	if (event.mode !== 'ranking') {
		return <p className="rounded-xl bg-card p-6">{m.allocation_booking_mode()}</p>
	}

	const workshopById = new Map(workshops.map((w) => [w.id, w]))
	const sessionById = new Map(sessions.map((s) => [s.id, s]))
	const sessionLabel = (id: string) => {
		const s = sessionById.get(id)
		return s ? `${s.workshopTitle} · ${formatShortDayTime(s.startsAt, event.timezone)}` : ''
	}

	async function run<T>(work: () => Promise<{ ok: true; data: T } | { ok: false; code: string }>) {
		setError(null)
		setStatus(null)
		setPending(true)
		const result = await work().catch(() => null)
		setPending(false)
		if (!result) {
			setError(m.error_generic())
			return null
		}
		if (!result.ok) {
			setError(actionMessage(result as Parameters<typeof actionMessage>[0]))
			return null
		}
		await router.invalidate()
		return result.data
	}

	const visible = (review?.people ?? []).filter(
		(p) =>
			filter === 'all' ||
			(filter === 'empty' && p.empty > 0) ||
			(filter === 'notop3' && !p.sessions.some((s) => s.rank !== null && s.rank <= 3)),
	)
	const isDraft = review?.run.status === 'draft'

	return (
		<div className="flex flex-col gap-6">
			<section className="flex flex-col gap-4 rounded-xl bg-card p-5">
				<p className="font-bold">
					{m.allocation_progress({
						ranked: String(progress.ranked),
						total: String(progress.registrations),
					})}
				</p>
				{canEdit && (
					<>
						<RadioCards
							name="strategy"
							legend={m.strategy_legend()}
							value={strategy}
							onChange={setStrategy}
							options={[
								{
									value: 'take-turns',
									title: m.strategy_take_turns(),
									body: m.strategy_take_turns_body(),
								},
								{
									value: 'early-birds',
									title: m.strategy_early_birds(),
									body: m.strategy_early_birds_body(),
								},
							]}
						/>
						<div>
							<Button
								disabled={pending || progress.registrations === 0}
								onClick={() => run(() => runDraftFn({ data: { eventId: event.id, strategy } }))}
							>
								{review ? m.run_again() : m.run_allocation()}
							</Button>
						</div>
					</>
				)}
			</section>

			<p aria-live="polite" role="status" className="font-bold empty:hidden">
				{status}
			</p>
			<FormError message={error} />

			{review && (
				<>
					<section aria-labelledby="metrics" className="flex flex-col gap-2 rounded-xl bg-card p-5">
						<h2 id="metrics" className="flex items-center gap-3 text-lg font-bold">
							{isDraft ? m.run_draft_label() : m.run_published_label()}
						</h2>
						<p>
							{m.metric_first_choice({
								count: String(review.metrics.firstChoice),
								total: String(review.metrics.ranked),
							})}
						</p>
						<p>
							{review.metrics.emptyPlaces === 0
								? m.metric_no_empty()
								: m.metric_empty({
										places: String(review.metrics.emptyPlaces),
										people: String(review.metrics.peopleWithEmpty),
									})}
						</p>
						<p className="font-mono text-sm text-muted-foreground">
							{review.metrics.rankCounts
								.map((count, i) => m.metric_choice({ rank: String(i + 1), count: String(count) }))
								.join(' · ')}
						</p>
						{review.metrics.manualChanges > 0 && (
							<p className="text-sm">
								{m.metric_manual({ count: String(review.metrics.manualChanges) })}
							</p>
						)}
						{isDraft && canEdit && (
							<div className="mt-2 flex flex-wrap gap-2">
								{review.metrics.emptyPlaces > 0 && (
									<Button
										variant="outline"
										disabled={pending}
										title={m.fill_empty_hint()}
										onClick={() => run(() => fillEmptyFn({ data: review.run.id }))}
									>
										{m.fill_empty()}
									</Button>
								)}
								{canPublish && (
									<Button
										disabled={pending}
										onClick={async () => {
											const preview = await run(() => publishPreviewFn({ data: review.run.id }))
											if (preview) setConfirm(preview)
										}}
									>
										{m.publish_results()}
									</Button>
								)}
							</div>
						)}
						{isDraft && review.metrics.emptyPlaces > 0 && (
							<p className="text-sm text-muted-foreground">{m.fill_empty_hint()}</p>
						)}
					</section>

					{confirm && (
						<section className="flex flex-col gap-3 rounded-xl bg-tint-warning p-5">
							<p>
								{confirm.firstPublish
									? m.publish_confirm_first({ count: String(review.metrics.participants) })
									: m.publish_confirm_again({ count: String(confirm.peopleChanging) })}
							</p>
							<div className="flex gap-2">
								<Button
									disabled={pending}
									onClick={async () => {
										const result = await run(() =>
											publishFn({ data: { eventId: event.id, runId: review.run.id } }),
										)
										setConfirm(null)
										if (result) setStatus(m.results_published({ count: String(result.sent) }))
									}}
								>
									{m.publish_results()}
								</Button>
								<Button variant="ghost" onClick={() => setConfirm(null)}>
									{m.cancel()}
								</Button>
							</div>
						</section>
					)}

					<label className="flex max-w-xs flex-col gap-1 text-sm font-bold">
						{m.filter_status()}
						<select
							className="h-11 rounded-md border border-input bg-card px-3 font-normal"
							value={filter}
							onChange={(e) => setFilter(e.target.value as typeof filter)}
						>
							<option value="all">{m.filter_all()}</option>
							<option value="empty">{m.filter_empty()}</option>
							<option value="notop3">{m.filter_no_top3()}</option>
						</select>
					</label>

					<ul className="flex flex-col gap-2">
						{visible.map((person) => (
							<PersonRow
								key={person.registrationId}
								person={person}
								name={names[person.registrationId] ?? ''}
								open={open === person.registrationId}
								onToggle={() =>
									setOpen(open === person.registrationId ? null : person.registrationId)
								}
								editable={isDraft && canEdit}
								workshopOf={(id) => workshopById.get(id)}
								sessionLabel={sessionLabel}
								sessionIds={sessions.map((s) => s.id)}
								onMove={async (move) => {
									setError(null)
									const result = await moveFn({
										data: { runId: review.run.id, registrationId: person.registrationId, ...move },
									}).catch(() => null)
									if (!result) {
										setError(m.error_generic())
										return
									}
									if (!result.ok) {
										const code = result.issues?.toSessionId ?? ''
										setError((moveErrors[code] ?? m.error_generic)())
										return
									}
									await router.invalidate()
								}}
							/>
						))}
					</ul>
				</>
			)}
		</div>
	)
}

function PersonRow({
	person,
	name,
	open,
	onToggle,
	editable,
	workshopOf: workshop,
	sessionLabel,
	sessionIds,
	onMove,
}: {
	person: Person
	name: string
	open: boolean
	onToggle: () => void
	editable: boolean
	workshopOf: (id: string) => WorkshopLook | undefined
	sessionLabel: (id: string) => string
	sessionIds: string[]
	onMove: (move: { fromSessionId?: string; toSessionId?: string }) => Promise<void>
}) {
	const [target, setTarget] = useState('')
	return (
		<li className="flex flex-col gap-2 rounded-xl bg-card p-4">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<p className="font-bold">{name}</p>
					<p className="text-sm text-muted-foreground">
						{m.column_ranking()}:{' '}
						{person.ranking.map((id, i) => `${i + 1}. ${workshop(id)?.title ?? ''}`).join(' · ') ||
							'—'}
					</p>
				</div>
				<Button
					variant="ghost"
					aria-expanded={open}
					aria-label={m.details_for({ name })}
					onClick={onToggle}
				>
					{open ? '−' : '+'}
				</Button>
			</div>
			<ul className="flex flex-col gap-1">
				{person.sessions.map((s) => {
					const w = workshop(s.workshopId)
					return (
						<li key={s.sessionId} className="flex items-center gap-2 text-sm">
							{w && <Marker color={w.markerColor} shape={w.markerShape} className="size-4" />}
							<span className="flex-1">{sessionLabel(s.sessionId)}</span>
							<span className="font-mono text-muted-foreground">{s.rank ? `#${s.rank}` : '·'}</span>
							{open && editable && (
								<Button
									variant="ghost"
									className="h-9 px-2 text-sm"
									aria-label={m.remove_place({ workshop: w?.title ?? '' })}
									onClick={() => onMove({ fromSessionId: s.sessionId })}
								>
									×
								</Button>
							)}
						</li>
					)
				})}
				{person.empty > 0 && (
					<li className="text-sm font-bold">{m.empty_places({ count: String(person.empty) })}</li>
				)}
			</ul>
			{open && (
				<div className="flex flex-col gap-3 border-t border-border pt-3">
					<Explanation trace={person.trace} titleOf={(id) => workshop(id)?.title ?? ''} />
					{editable && (
						<div className="flex flex-wrap items-end gap-2">
							<label className="flex flex-col gap-1 text-sm font-bold">
								{m.add_place()}
								<select
									className="h-11 max-w-72 rounded-md border border-input bg-card px-3 font-normal"
									value={target}
									onChange={(e) => setTarget(e.target.value)}
								>
									<option value="">{m.choose_session()}</option>
									{sessionIds.map((id) => (
										<option key={id} value={id}>
											{sessionLabel(id)}
										</option>
									))}
								</select>
							</label>
							<Button
								variant="outline"
								disabled={!target}
								onClick={async () => {
									await onMove({ toSessionId: target })
									setTarget('')
								}}
							>
								{m.apply_move()}
							</Button>
						</div>
					)}
				</div>
			)}
		</li>
	)
}
