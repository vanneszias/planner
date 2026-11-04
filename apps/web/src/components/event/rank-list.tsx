import { Button } from '@app/ui/components/button'
import { Marker, type MarkerColor, type MarkerShape } from '@app/ui/components/marker'
import { cn } from 'cn'
import { Check, ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { FormError } from '#/components/auth-shell'
import { m } from '#/paraglide/messages'

export type RankableWorkshop = {
	id: string
	title: string
	markerColor: MarkerColor
	markerShape: MarkerShape
	/** Session times, shown only when the event allows it (D7). */
	times: string[]
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
}: {
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
	const [pending, setPending] = useState(false)
	const unranked = workshops.filter((w) => !ranked.includes(w.id))
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
					{m.rank_intro({ min: String(rules.min), max: String(rules.max) })}
				</p>
				<div className="mt-3 flex items-center gap-3" aria-live="polite">
					<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-accent" aria-hidden>
						<div
							className="h-full rounded-full bg-primary transition-[width]"
							style={{ width: `${Math.min(100, (ranked.length / rules.max) * 100)}%` }}
						/>
					</div>
					<p className="text-sm font-bold tabular-nums">
						{m.rank_count({ count: String(ranked.length), max: String(rules.max) })}
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
							className="flex items-center gap-2.5 rounded-xl bg-card p-2 pl-3 shadow-card"
						>
							<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-bold text-white tabular-nums">
								{index + 1}
							</span>
							<Marker color={workshop.markerColor} shape={workshop.markerShape} />
							<WorkshopName workshop={workshop} contentLocale={contentLocale} />
							<Button
								variant="outline"
								size="icon-lg"
								className="max-sm:size-9"
								aria-label={m.move_up({ workshop: workshop.title })}
								aria-disabled={index === 0 || undefined}
								onClick={() => move(index, -1)}
							>
								<ChevronUp aria-hidden />
							</Button>
							<Button
								variant="outline"
								size="icon-lg"
								className="max-sm:size-9"
								aria-label={m.move_down({ workshop: workshop.title })}
								aria-disabled={index === ranked.length - 1 || undefined}
								onClick={() => move(index, 1)}
							>
								<ChevronDown aria-hidden />
							</Button>
							<Button
								variant="ghost"
								size="icon-lg"
								className="text-muted-foreground hover:bg-tint-danger hover:text-destructive max-sm:size-9"
								aria-label={m.remove_from_ranking({ workshop: workshop.title })}
								data-rank-remove={id}
								onClick={() => remove(id)}
							>
								<X aria-hidden />
							</Button>
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
								className="flex items-center gap-2.5 rounded-xl border border-dashed border-edge/50 bg-card/60 p-2 pl-3"
							>
								<span
									className="size-7 shrink-0 rounded-full border-2 border-dashed border-edge/50"
									aria-hidden
								/>
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
				<p
					aria-live="polite"
					className={cn(
						'flex items-center gap-2 rounded-lg bg-tint-success px-3 py-2 text-sm font-bold',
						!saved && 'hidden',
					)}
				>
					<Check aria-hidden className="size-4 shrink-0 text-success" strokeWidth={3} />
					{saved}
				</p>
				<Button className="w-full" aria-disabled={pending || undefined} onClick={save}>
					{saveLabel}
				</Button>
			</div>
		</section>
	)
}

function WorkshopName({
	workshop,
	contentLocale,
}: {
	workshop: RankableWorkshop
	contentLocale: string
}) {
	return (
		<span className="min-w-0 flex-1">
			<span className="block leading-snug font-bold" lang={contentLocale}>
				{workshop.title}
			</span>
			{workshop.times.length > 0 && (
				<span className="mt-1 flex flex-wrap gap-1">
					{workshop.times.map((time) => (
						<span
							key={time}
							className="rounded bg-accent px-1.5 py-px text-xs font-bold whitespace-nowrap text-muted-foreground tabular-nums"
						>
							{time}
						</span>
					))}
				</span>
			)}
		</span>
	)
}
