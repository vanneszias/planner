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
				className="h-11 w-full cursor-pointer appearance-none rounded-md border border-input bg-card pr-10 pl-3 text-base shadow-xs"
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

/** Cancel then submit, right-aligned on wider screens; full width stacked on phones. */
export function FormActions({ children }: { children: ReactNode }) {
	return (
		<div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:justify-end">
			{children}
		</div>
	)
}
