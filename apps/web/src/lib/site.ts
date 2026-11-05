import { brand, brandAssets } from '@app/brand'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequestUrl } from '@tanstack/react-start/server'
import { getLocale } from '#/paraglide/runtime'

/** This deployment's origin: share cards need absolute URLs, and previews each have their own. */
const origin = createIsomorphicFn()
	.server(() => getRequestUrl().origin)
	.client(() => window.location.origin)

/**
 * Open Graph and Twitter tags for a page's link preview. The root route sets
 * the platform defaults; pages pass their own title and description, which
 * replace those by name (TanStack keeps the deepest match's tag).
 */
export function shareMeta(page: { title: string; description: string }) {
	return [
		{ property: 'og:title', content: page.title },
		{ property: 'og:description', content: page.description },
		{ name: 'twitter:title', content: page.title },
		{ name: 'twitter:description', content: page.description },
	]
}

/** Platform defaults: site name, share image and card type. */
export function defaultShareMeta() {
	const image = `${origin()}${brandAssets.ogImage}`
	const locale = getLocale()
	return [
		{ property: 'og:site_name', content: brand.name },
		{ property: 'og:type', content: 'website' },
		{ property: 'og:locale', content: locale === 'nl' ? 'nl_BE' : 'en_GB' },
		{ property: 'og:image', content: image },
		{ property: 'og:image:width', content: '1200' },
		{ property: 'og:image:height', content: '630' },
		{ property: 'og:image:alt', content: `${brand.name}: ${brand.description[locale]}` },
		{ name: 'twitter:card', content: 'summary_large_image' },
		{ name: 'twitter:image', content: image },
		...shareMeta({ title: brand.name, description: brand.description[locale] }),
	]
}
