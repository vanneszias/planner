import { Button } from '@app/ui/components/button'
import { Pencil, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { m } from '#/paraglide/messages'

/** One line of context on the left, the page's primary action on the right. */
export function PageToolbar({ summary, children }: { summary?: ReactNode; children?: ReactNode }) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-3">
			<p className="text-muted-foreground">{summary}</p>
			{children && <div className="flex flex-wrap gap-2">{children}</div>}
		</div>
	)
}

/** An empty or waiting state: icon, one sentence, optional next step. */
export function EmptyState({
	icon,
	title,
	body,
	action,
}: {
	icon?: ReactNode
	title: ReactNode
	body?: ReactNode
	action?: ReactNode
}) {
	return (
		<div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-edge/60 bg-card px-6 py-10 text-center">
			{icon && (
				<span className="flex size-11 items-center justify-center rounded-full bg-accent text-muted-foreground [&_svg]:size-5">
					{icon}
				</span>
			)}
			<p className="max-w-md font-bold">{title}</p>
			{body && <p className="max-w-md text-sm text-muted-foreground">{body}</p>}
			{action && <div className="mt-1">{action}</div>}
		</div>
	)
}

/**
 * Edit and delete as quiet icon buttons; the labels name the row for screen readers.
 * With a mouse they appear on hover or focus of the surrounding `group`; on touch they always show.
 */
export function RowActions({
	label,
	onEdit,
	onDelete,
}: {
	label: string
	onEdit?: () => void
	onDelete?: () => void
}) {
	return (
		<span className="-my-1 flex shrink-0 gap-0.5 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
			{onEdit && (
				<Button
					variant="ghost"
					size="icon-sm"
					className="text-muted-foreground hover:text-foreground"
					aria-label={`${m.edit()}: ${label}`}
					title={m.edit()}
					onClick={onEdit}
				>
					<Pencil />
				</Button>
			)}
			{onDelete && (
				<Button
					variant="ghost"
					size="icon-sm"
					className="text-muted-foreground hover:bg-tint-danger hover:text-destructive"
					aria-label={`${m.delete()}: ${label}`}
					title={m.delete()}
					onClick={onDelete}
				>
					<Trash2 />
				</Button>
			)}
		</span>
	)
}
