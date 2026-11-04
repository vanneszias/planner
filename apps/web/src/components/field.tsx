import { Input } from '@app/ui/components/input'
import { Label } from '@app/ui/components/label'
import { cn } from 'cn'
import { ChevronDown } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { fieldMessage } from '#/lib/errors'

/**
 * Label, control, hint and error, wired for screen readers: the error is
 * linked with aria-describedby and the control marked aria-invalid.
 */
export function Field({
	id,
	label,
	hint,
	error,
	children,
}: {
	id: string
	label: string
	hint?: string
	error?: string
	children?: ReactNode
}) {
	const message = fieldMessage(error)
	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor={id}>{label}</Label>
			{children}
			{hint && (
				<p id={`${id}-hint`} className="text-sm text-muted-foreground">
					{hint}
				</p>
			)}
			{message && (
				<p id={`${id}-error`} className="text-sm font-bold text-destructive">
					{message}
				</p>
			)}
		</div>
	)
}

/** An Input that knows its Field's hint and error ids. */
export function FieldInput({
	id,
	error,
	hint,
	...props
}: ComponentProps<typeof Input> & { id: string; error?: string; hint?: boolean }) {
	const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ')
	return (
		<Input
			id={id}
			aria-invalid={error ? true : undefined}
			aria-describedby={describedBy || undefined}
			{...props}
		/>
	)
}

/** A native select styled like Input, with a chevron. */
export function FieldSelect({ className, children, ...props }: ComponentProps<'select'>) {
	return (
		<div className={cn('relative', className)}>
			<select
				className="h-10 w-full cursor-pointer appearance-none rounded-md border border-input bg-card pr-10 pl-3 text-base font-normal shadow-xs aria-invalid:border-destructive"
				{...props}
			>
				{children}
			</select>
			<ChevronDown
				aria-hidden
				className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
			/>
		</div>
	)
}

/**
 * Cancel then submit, right-aligned on wider screens; full width stacked on phones.
 * Sticks to the bottom of a scrolling dialog so the actions stay in reach.
 */
export function FormActions({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
	return (
		<div className="sticky -bottom-6 z-10 -mx-6 -mb-6 flex flex-wrap items-center gap-2 border-t border-border bg-card px-6 py-4">
			{aside && <div className="mr-auto">{aside}</div>}
			<div className="flex flex-1 justify-end gap-2 max-sm:[&>*]:flex-1">{children}</div>
		</div>
	)
}

/** A FieldInput joined to a fixed prefix, e.g. the "/organization/" part of a web address. */
export function PrefixedInput({
	prefix,
	className,
	...props
}: ComponentProps<typeof FieldInput> & { prefix: string }) {
	return (
		<div className="flex h-10 min-w-0 items-stretch overflow-hidden rounded-md border border-input bg-card shadow-xs focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring has-aria-invalid:border-destructive">
			<span className="flex shrink-0 items-center border-r border-border bg-accent px-3 text-sm whitespace-nowrap text-muted-foreground">
				{prefix}
			</span>
			<FieldInput
				className={cn(
					'h-full min-w-0 rounded-none border-0 shadow-none focus-visible:outline-none',
					className,
				)}
				{...props}
			/>
		</div>
	)
}
