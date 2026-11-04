import { brand } from '@app/brand'
import type { ReactNode } from 'react'
import { BrandMark } from './brand-mark'
import { LanguageSwitch } from './language-switch'

/** Centered single-column layout for sign-in and sign-up. Mobile first. */
export function AuthShell({
	title,
	intro,
	children,
	footer,
}: {
	title: string
	intro?: string
	children: ReactNode
	footer?: ReactNode
}) {
	return (
		<div className="flex min-h-dvh flex-col px-4 py-8">
			<header className="mx-auto flex w-full max-w-md items-center justify-between">
				<span className="flex items-center gap-2 font-display text-base font-semibold">
					<BrandMark />
					{brand.name}
				</span>
				<LanguageSwitch />
			</header>
			<main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
				<h1 className="mb-2 font-display text-[clamp(1.75rem,6vw,2.25rem)] leading-tight font-semibold text-balance wrap-break-word">
					{title}
				</h1>
				{intro && <p className="mb-8 text-muted-foreground">{intro}</p>}
				<div className="rounded-xl bg-card shadow-card p-5 sm:p-6">{children}</div>
				{footer && <div className="mt-6 text-center">{footer}</div>}
			</main>
		</div>
	)
}

/** Error text tied to a form. Announced politely; never colour alone. */
export function FormError({ message }: { message: string | null }) {
	return (
		<p role="alert" className="text-sm font-bold text-destructive empty:hidden">
			{message}
		</p>
	)
}
