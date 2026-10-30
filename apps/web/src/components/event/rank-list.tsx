import { Button } from '@app/ui/components/button'
import { Marker, type MarkerColor, type MarkerShape } from '@app/ui/components/marker'
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
}: {
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
				: '',
		)
	}

	function move(index: number, by: -1 | 1) {
		const next = [...ranked]
		const [item] = next.splice(index, 1)
		if (!item) return
		next.splice(index + by, 0, item)
		update(next, item)
	}

	async function save() {
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
				<h2 id="rank-title" className="font-display text-xl font-medium">
					{heading}
				</h2>
				<p className="text-muted-foreground">
					{m.rank_intro({ min: String(rules.min), max: String(rules.max) })}
				</p>
				<p className="mt-1 font-mono text-sm">
					{m.rank_count({ count: String(ranked.length), max: String(rules.max) })}
				</p>
			</div>

			<p aria-live="polite" className="sr-only">
				{announcement}
			</p>

			<ol className="flex flex-col gap-2">
				{ranked.map((id, index) => {
					const workshop = byId.get(id)
					if (!workshop) return null
					return (
						<li key={id} className="flex items-center gap-2 rounded-xl bg-card p-2 pl-3">
							<span className="w-5 font-mono">{index + 1}</span>
							<Marker color={workshop.markerColor} shape={workshop.markerShape} />
							<WorkshopName workshop={workshop} contentLocale={contentLocale} />
							<Button
								variant="outline"
								size="icon"
								aria-label={m.move_up({ workshop: workshop.title })}
								disabled={index === 0}
								onClick={() => move(index, -1)}
							>
								<span aria-hidden="true">↑</span>
							</Button>
							<Button
								variant="outline"
								size="icon"
								aria-label={m.move_down({ workshop: workshop.title })}
								disabled={index === ranked.length - 1}
								onClick={() => move(index, 1)}
							>
								<span aria-hidden="true">↓</span>
							</Button>
							<Button
								variant="ghost"
								size="icon"
								aria-label={m.remove_from_ranking({ workshop: workshop.title })}
								onClick={() =>
									update(
										ranked.filter((r) => r !== id),
										id,
									)
								}
							>
								<span aria-hidden="true">×</span>
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
							<li key={workshop.id} className="flex items-center gap-2 rounded-xl bg-card p-2 pl-3">
								<span className="w-5" />
								<Marker color={workshop.markerColor} shape={workshop.markerShape} />
								<WorkshopName workshop={workshop} contentLocale={contentLocale} />
								<Button
									variant="outline"
									size="icon"
									aria-label={m.add_to_ranking({ workshop: workshop.title })}
									disabled={ranked.length >= rules.max}
									onClick={() => update([...ranked, workshop.id], workshop.id)}
								>
									<span aria-hidden="true">+</span>
								</Button>
							</li>
						))}
					</ul>
				</>
			)}

			<FormError message={error} />
			<p aria-live="polite" className="font-bold empty:hidden">
				{saved}
			</p>
			<div className="sticky bottom-3">
				<Button className="w-full shadow-md" disabled={pending} onClick={save}>
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
		<span className="flex-1">
			<span className="block font-bold" lang={contentLocale}>
				{workshop.title}
			</span>
			{workshop.times.length > 0 && (
				<span className="font-mono text-sm text-muted-foreground">
					{workshop.times.join(' · ')}
				</span>
			)}
		</span>
	)
}
