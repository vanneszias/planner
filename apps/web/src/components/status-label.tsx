import type { Event } from '@app/domain'
import { cn } from 'cn'
import { m } from '#/paraglide/messages'

const labels: Record<Event['status'], () => string> = {
	draft: m.status_draft,
	published: m.status_published,
	closed: m.status_closed,
	archived: m.status_archived,
}

/** Event status as text on a tint: never colour alone. */
export function StatusLabel({ status }: { status: Event['status'] }) {
	return (
		<span
			className={cn(
				'rounded-full px-3 py-1 text-sm font-bold',
				status === 'published' ? 'bg-tint-success' : 'bg-accent',
			)}
		>
			{labels[status]()}
		</span>
	)
}
