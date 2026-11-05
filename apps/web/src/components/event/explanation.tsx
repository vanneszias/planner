import type { TraceEntry } from '@app/allocation'
import { m } from '#/paraglide/messages'

/**
 * "Why you got these sessions" (D9): the engine's codes as sentences. Only
 * the participant's own trace, which never mentions anyone else.
 */
export function Explanation({
	trace,
	titleOf,
}: {
	trace: TraceEntry[]
	titleOf: (workshopId: string) => string
}) {
	const lines = trace.map((entry) => {
		if (entry.kind === 'exhausted') return m.trace_exhausted()
		const workshop = titleOf(entry.workshopId)
		if (entry.kind === 'assigned') return m.trace_assigned({ workshop, rank: String(entry.rank) })
		if (entry.kind === 'filled') return m.trace_filled({ workshop })
		switch (entry.reason) {
			case 'full':
				return m.trace_full({ workshop })
			case 'overlap':
				return m.trace_overlap({ workshop })
			case 'not_eligible':
				return m.trace_not_eligible({ workshop })
			default:
				return m.trace_no_sessions({ workshop })
		}
	})
	if (lines.length === 0) return null
	return (
		<section aria-labelledby="why" className="rounded-xl bg-card shadow-card p-4">
			<h3 id="why" className="mb-2 font-bold">
				{m.why_title()}
			</h3>
			<ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
				{lines.map((line, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: the trace is fixed and ordered
					<li key={index}>{line}</li>
				))}
			</ul>
		</section>
	)
}
