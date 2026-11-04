import { cn } from 'cn'
import { X } from 'lucide-react'
import { AlertDialog as AlertPrimitive, Dialog as DialogPrimitive } from 'radix-ui'
import type * as React from 'react'
import { Button } from './button'

const overlay = 'fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px]'
const panel =
	'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-5 overflow-y-auto rounded-xl bg-card p-6 shadow-[0_24px_64px_-16px_rgb(28_30_51/0.35)] focus:outline-none'

/**
 * A modal form or detail panel. Title is required (screen readers announce it);
 * `icon` sits beside the title, e.g. a workshop marker.
 */
export function Dialog({
	open,
	onOpenChange,
	title,
	description,
	icon,
	children,
	className,
	closeLabel,
}: {
	closeLabel: string
	open: boolean
	onOpenChange: (open: boolean) => void
	title: React.ReactNode
	description?: React.ReactNode
	icon?: React.ReactNode
	children: React.ReactNode
	className?: string
}) {
	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className={overlay} />
				<DialogPrimitive.Content
					className={cn(panel, className)}
					{...(!description && { 'aria-describedby': undefined })}
				>
					<div className="flex items-start gap-3">
						{icon && <span className="mt-1.5 shrink-0">{icon}</span>}
						<div className="flex flex-1 flex-col gap-1">
							<DialogPrimitive.Title className="font-display text-xl leading-snug font-semibold">
								{title}
							</DialogPrimitive.Title>
							{description && (
								<DialogPrimitive.Description className="text-sm text-muted-foreground">
									{description}
								</DialogPrimitive.Description>
							)}
						</div>
						<DialogPrimitive.Close asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								className="-mt-1 -mr-2"
								aria-label={closeLabel}
							>
								<X />
							</Button>
						</DialogPrimitive.Close>
					</div>
					{children}
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	)
}

/** Styled replacement for window.confirm: names the thing and the consequence. */
export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel,
	cancelLabel,
	onConfirm,
	destructive = true,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	title: React.ReactNode
	description?: React.ReactNode
	confirmLabel: string
	cancelLabel: string
	onConfirm: () => void | Promise<void>
	destructive?: boolean
}) {
	return (
		<AlertPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<AlertPrimitive.Portal>
				<AlertPrimitive.Overlay className={overlay} />
				<AlertPrimitive.Content className={cn(panel, 'max-w-md')}>
					<div className="flex flex-col gap-2">
						<AlertPrimitive.Title className="font-display text-lg leading-snug font-semibold">
							{title}
						</AlertPrimitive.Title>
						<AlertPrimitive.Description className="text-muted-foreground">
							{description}
						</AlertPrimitive.Description>
					</div>
					<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						<AlertPrimitive.Cancel asChild>
							<Button variant="outline">{cancelLabel}</Button>
						</AlertPrimitive.Cancel>
						<AlertPrimitive.Action asChild>
							<Button
								variant={destructive ? 'destructive' : 'default'}
								onClick={() => void onConfirm()}
							>
								{confirmLabel}
							</Button>
						</AlertPrimitive.Action>
					</div>
				</AlertPrimitive.Content>
			</AlertPrimitive.Portal>
		</AlertPrimitive.Root>
	)
}
