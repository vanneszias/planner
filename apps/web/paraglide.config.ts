import { brand } from '@app/brand'

/**
 * Paraglide options, shared by the Vite plugin and `scripts/paraglide.ts` (used
 * by typecheck), so both generate the same runtime.
 */
export const paraglideOptions = {
	project: './project.inlang',
	outdir: './src/paraglide',
	emitTsDeclarations: true,
	cookieName: `${brand.slug}.locale`,
	// No locale in URLs: event links are shared across languages.
	strategy: ['cookie', 'preferredLanguage', 'baseLocale'] as (
		| 'cookie'
		| 'preferredLanguage'
		| 'baseLocale'
	)[],
}
