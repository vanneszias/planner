import { Button } from '@app/ui/components/button'
import { Marker, type MarkerColor, type MarkerShape } from '@app/ui/components/marker'
import { cn } from 'cn'
import { Check, ChevronDown, ChevronUp, Lock, Plus, X } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { FormError } from '#/components/auth-shell'
import { m } from '#/paraglide/messages'

export type RankableWorkshop = {
	id: string
	title: string
	markerColor: MarkerColor
	markerShape: MarkerShape
	/** Session times, shown only when the event allows it (D7). */
	times: string[]
	/** What the workshop is about: helps people choose between unfamiliar titles. */
	description?: string
}

/**
 * Ranking (journeys.md P2, design-system.md "RankList"). Up and down buttons
 * are the primary interaction (WCAG 2.5.7: no dragging required); each move is
 * announced through a polite live region.
 */
export function RankList({
	workshops,
	initial,
	rules,
	contentLocale,
	onSave,
	title: heading = m.rank_title(),
	savedMessage = m.ranking_saved(),
	saveLabel = m.save_ranking(),
	hideTitle = false,
	sessions,
	draftKey,
}: {
	/** Keeps unsaved picks in this browser under this key, so a reload doesn't lose them. */
	draftKey?: string
	/** How many sessions each person gets; explains why they rank more than that. */
	sessions?: number
	/** In a dialog the dialog's title names the list. */
	hideTitle?: boolean
	workshops: RankableWorkshop[]
	initial: string[]
	rules: { min: number; max: number }
	contentLocale: string
	onSave: (ranking: string[]) => Promise<string | null>
	/** Organizers entering someone else's ranking see their own wording. */
	title?: string
	savedMessage?: string
	saveLabel?: string
}) {
	const byId = new Map(workshops.map((w) => [w.id, w]))
	const [ranked, setRanked] = useState(initial.filter((id) => byId.has(id)))
	const [announcement, setAnnouncement] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [saved, setSaved] = useState<string | null>(null)
	// What the server has: a ranking that matches it needs no save.
	const [stored, setStored] = useState(initial.join())
	const [pending, setPending] = useState(false)
	const unranked = workshops.filter((w) => !ranked.includes(w.id))
	const missing = Math.max(0, rules.min - ranked.length)
	const upToDate = ranked.length > 0 && ranked.join() === stored
	const dirty = ranked.join() !== stored

	// Restore picks made but not saved before a reload (browser storage can be unavailable).
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once, after hydration
	useEffect(() => {
		if (!draftKey) return
		try {
			const draft = JSON.parse(localStorage.getItem(draftKey) ?? 'null')
			if (Array.isArray(draft)) {
				const kept = draft.filter((id): id is string => typeof id === 'string' && byId.has(id))
				if (kept.length > 0 && kept.join() !== stored) setRanked(kept)
			}
		} catch {}
	}, [])

	// Keep the draft in step with the list; drop it once the server has the same order.
	useEffect(() => {
		if (!draftKey) return
		try {
			if (dirty) localStorage.setItem(draftKey, JSON.stringify(ranked))
			else localStorage.removeItem(draftKey)
		} catch {}
	}, [draftKey, dirty, ranked])

	// Leaving with unsaved picks asks first.
	useEffect(() => {
		if (!dirty) return
		const warn = (event: BeforeUnloadEvent) => event.preventDefault()
		window.addEventListener('beforeunload', warn)
		return () => window.removeEventListener('beforeunload', warn)
	}, [dirty])
	const title = (id: string) => byId.get(id)?.title ?? ''

	function update(next: string[], moved: string) {
		setRanked(next)
		setSaved(null)
		const position = next.indexOf(moved) + 1
		setAnnouncement(
			position > 0
				? m.moved_to_position({
						workshop: title(moved),
						position: String(position),
						count: String(next.length),
					})
				: m.removed_from_ranking({ workshop: title(moved) }),
		)
	}

	/** Focus follows the workshop to where it went (ranked list or the rest). */
	const focusLater = (selector: string) =>
		requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus())

	function add(id: string) {
		if (ranked.length >= rules.max) {
			return setAnnouncement(m.ranking_too_many({ max: String(rules.max) }))
		}
		update([...ranked, id], id)
		focusLater(`[data-rank-remove="${id}"]`)
	}

	function remove(id: string) {
		update(
			ranked.filter((r) => r !== id),
			id,
		)
		focusLater(`[data-rank-add="${id}"]`)
	}

	function move(index: number, by: -1 | 1) {
		if (index + by < 0 || index + by >= ranked.length) return
		const next = [...ranked]
		const [item] = next.splice(index, 1)
		if (!item) return
		next.splice(index + by, 0, item)
		update(next, item)
	}

	async function save() {
		if (pending) return
		setError(null)
		if (ranked.length < rules.min) return setError(m.ranking_too_few({ min: String(rules.min) }))
		if (ranked.length > rules.max) return setError(m.ranking_too_many({ max: String(rules.max) }))
		setPending(true)
		const problem = await onSave(ranked)
		setPending(false)
		if (problem) return setError(problem)
		setSaved(savedMessage)
		setStored(ranked.join())
	}

	return (
		<section aria-labelledby="rank-title" className="flex flex-col gap-4">
			<div>
				<h2
					id="rank-title"
					className={cn('font-display text-xl font-semibold', hideTitle && 'sr-only')}
				>
					{heading}
				</h2>
				<p className="text-muted-foreground">
					{sessions
						? m.rank_intro_sessions({
								sessions: String(sessions),
								min: String(rules.min),
								max: String(rules.max),
							})
						: m.rank_intro({ min: String(rules.min), max: String(rules.max) })}
				</p>
				<div className="mt-3 flex items-center gap-3" aria-live="polite">
					<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-accent" aria-hidden>
						<div
							className="h-full rounded-full bg-primary transition-[width]"
							style={{
								width: `${missing > 0 ? (ranked.length / Math.max(1, rules.min)) * 100 : 100}%`,
							}}
						/>
					</div>
					<p className="text-sm font-bold tabular-nums">
						{missing > 0
							? m.rank_progress_needed({ count: String(ranked.length), min: String(rules.min) })
							: ranked.length >= rules.max
								? m.rank_progress_full({ count: String(ranked.length) })
								: m.rank_progress_enough({
										count: String(ranked.length),
										max: String(rules.max),
									})}
					</p>
				</div>
			</div>

			<p aria-live="polite" className="sr-only">
				{announcement}
			</p>

			<ol className="flex flex-col gap-2">
				{ranked.map((id, index) => {
					const workshop = byId.get(id)
					if (!workshop) return null
					return (
						<li
							key={id}
							className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 rounded-xl bg-card p-2 pl-3 shadow-card"
						>
							<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-bold text-white tabular-nums">
								{index + 1}
							</span>
							<Marker color={workshop.markerColor} shape={workshop.markerShape} />
							<WorkshopName workshop={workshop} contentLocale={contentLocale} hideTimes />
							<span className="flex shrink-0 gap-1">
								<Button
									variant="outline"
									size="icon-lg"
									className="size-9 border-ink/40 text-foreground aria-disabled:opacity-35"
									aria-label={m.move_up({ workshop: workshop.title })}
									aria-disabled={index === 0 || undefined}
									onClick={() => move(index, -1)}
								>
									<ChevronUp aria-hidden />
								</Button>
								<Button
									variant="outline"
									size="icon-lg"
									className="size-9 border-ink/40 text-foreground aria-disabled:opacity-35"
									aria-label={m.move_down({ workshop: workshop.title })}
									aria-disabled={index === ranked.length - 1 || undefined}
									onClick={() => move(index, 1)}
								>
									<ChevronDown aria-hidden />
								</Button>
								<Button
									variant="ghost"
									size="icon-lg"
									className="size-9 text-muted-foreground hover:bg-tint-danger hover:text-destructive"
									aria-label={m.remove_from_ranking({ workshop: workshop.title })}
									data-rank-remove={id}
									onClick={() => remove(id)}
								>
									<X aria-hidden />
								</Button>
							</span>
							{workshop.times.length > 0 && (
								<Times times={workshop.times} className="col-span-2 col-start-3 max-sm:hidden" />
							)}
						</li>
					)
				})}
			</ol>

			{unranked.length > 0 && (
				<>
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<span className="h-px flex-1 bg-border" />
						{m.not_ranked()}
						<span className="h-px flex-1 bg-border" />
					</div>
					<ul className="flex flex-col gap-2">
						{unranked.map((workshop) => (
							<li
								key={workshop.id}
								className="flex items-center gap-2.5 rounded-xl bg-card p-2 pl-3 shadow-card"
							>
								<Marker color={workshop.markerColor} shape={workshop.markerShape} />
								<WorkshopName workshop={workshop} contentLocale={contentLocale} />
								<Button
									variant="outline"
									size="icon-lg"
									className="max-sm:size-9"
									aria-label={m.add_to_ranking({ workshop: workshop.title })}
									aria-disabled={ranked.length >= rules.max || undefined}
									data-rank-add={workshop.id}
									onClick={() => add(workshop.id)}
								>
									<Plus aria-hidden />
								</Button>
							</li>
						))}
					</ul>
				</>
			)}

			<div
				className={cn(
					'sticky bottom-0 z-10 flex flex-col gap-2 border-t border-border pt-3 backdrop-blur',
					hideTitle
						? '-mx-6 -mb-6 bg-card/95 px-6 pb-6'
						: '-mx-4 bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
				)}
			>
				<FormError message={error} />
				<p aria-live="polite" className="sr-only">
					{saved}
				</p>
				{dirty && missing === 0 && !error && (
					<p className="text-center text-sm text-muted-foreground">{m.ranking_draft()}</p>
				)}
				<Button
					className={cn(
						'w-full',
						missing > 0 &&
							'bg-accent text-muted-foreground hover:bg-accent aria-disabled:opacity-100',
						upToDate &&
							missing === 0 &&
							'bg-tint-success text-foreground hover:bg-tint-success aria-disabled:opacity-100',
					)}
					aria-disabled={pending || missing > 0 || upToDate || undefined}
					onClick={missing > 0 || upToDate ? undefined : save}
				>
					{missing > 0 ? (
						<>
							<Lock aria-hidden />
							{m.rank_pick_more({ count: String(missing) })}
						</>
					) : upToDate ? (
						<>
							<Check aria-hidden />
							{m.ranking_all_saved()}
						</>
					) : (
						saveLabel
					)}
				</Button>
			</div>
		</section>
	)
}

function WorkshopName({
	workshop,
	contentLocale,
	hideTimes = false,
}: {
	workshop: RankableWorkshop
	contentLocale: string
	/** Ranked rows show the times on a row of their own, below the controls. */
	hideTimes?: boolean
}) {
	return (
		<span className="min-w-0 flex-1">
			<span className="block leading-snug font-bold" lang={contentLocale}>
				{workshop.title}
			</span>
			{workshop.description && (
				<span className="line-clamp-2 text-sm text-muted-foreground" lang={contentLocale}>
					{workshop.description}
				</span>
			)}
			{!hideTimes && workshop.times.length > 0 && <Times times={workshop.times} className="mt-1" />}
		</span>
	)
}

/** A workshop's session times as one muted line; breaks only between times. */
function Times({ times, className }: { times: string[]; className?: string }) {
	return (
		<span className={cn('block text-sm text-muted-foreground tabular-nums', className)}>
			{times.map((time, index) => (
				<Fragment key={time}>
					{index > 0 && <span aria-hidden> · </span>}
					<span className="whitespace-nowrap">{time}</span>
				</Fragment>
			))}
		</span>
	)
}
