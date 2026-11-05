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
				'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-bold whitespace-nowrap',
				status === 'published' ? 'bg-tint-success' : 'bg-accent',
			)}
		>
			<span
				aria-hidden
				className={cn('size-1.5 rounded-full', status === 'published' ? 'bg-success' : 'bg-edge')}
			/>
			{labels[status]()}
		</span>
	)
}
