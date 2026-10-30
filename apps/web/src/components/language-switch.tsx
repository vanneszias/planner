import { m } from '#/paraglide/messages'
import { getLocale, locales, setLocale } from '#/paraglide/runtime'

const names = { en: 'English', nl: 'Nederlands' } as const

/** Native select: keyboard and screen-reader friendly without extra work. */
export function LanguageSwitch() {
	return (
		<label className="flex items-center gap-2 text-sm text-muted-foreground">
			<span className="sr-only">{m.language_switch()}</span>
			<select
				className="min-h-11 rounded-md border border-input bg-card px-2 text-foreground"
				value={getLocale()}
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
