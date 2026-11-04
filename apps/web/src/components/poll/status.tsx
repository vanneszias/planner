import type { Poll } from '@app/domain'
import { cn } from 'cn'
import { m } from '#/paraglide/messages'

const labels: Record<Poll['status'], () => string> = {
	open: m.poll_status_open,
	needs_decision: m.poll_status_needs_decision,
	confirmed: m.poll_status_confirmed,
	cancelled: m.poll_status_cancelled,
}

/** Poll status as text on a tint: never colour alone. */
export function PollStatusLabel({ status }: { status: Poll['status'] }) {
	return (
		<span
			className={cn(
				'rounded-full px-3 py-1 text-sm font-bold',
				status === 'confirmed' && 'bg-tint-success',
				status === 'needs_decision' && 'bg-tint-warning',
				(status === 'open' || status === 'cancelled') && 'bg-accent',
			)}
		>
			{labels[status]()}
		</span>
	)
}
