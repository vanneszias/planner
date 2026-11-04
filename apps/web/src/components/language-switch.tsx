import { cn } from 'cn'
import { ChevronDown, Globe } from 'lucide-react'
import { m } from '#/paraglide/messages'
import { getLocale, locales, setLocale } from '#/paraglide/runtime'

const names = { en: 'English', nl: 'Nederlands' } as const

/**
 * A native select (keyboard and screen-reader friendly) laid transparently
 * over a quiet header control: globe, language, chevron. `compact` shows only
 * just the globe on small screens.
 */
export function LanguageSwitch({ compact = false }: { compact?: boolean }) {
	const current = getLocale()
	return (
		<label className="relative flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-bold text-muted-foreground focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-ring hover:bg-accent hover:text-foreground">
			<span className="sr-only">{m.language_switch()}</span>
			<Globe aria-hidden className="size-4" />
			<span aria-hidden className={cn(compact && 'max-sm:hidden')}>
				{names[current]}
			</span>
			<ChevronDown aria-hidden className={cn('size-3.5', compact && 'max-sm:hidden')} />
			<select
				className="absolute inset-0 cursor-pointer appearance-none opacity-0 focus-visible:outline-none"
				value={current}
				onChange={(event) => setLocale(event.target.value as (typeof locales)[number])}
			>
				{locales.map((locale) => (
					<option key={locale} value={locale} lang={locale}>
						{names[locale]}
					</option>
				))}
			</select>
		</label>
	)
}
