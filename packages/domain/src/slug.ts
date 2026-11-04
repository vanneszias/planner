/** URL-safe slug: lowercase ASCII, digits and dashes. "Zomerkamp 2027 – Gent" → "zomerkamp-2027-gent". */
export function slugify(text: string, maxLength = 60): string {
	return text
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, maxLength)
		.replace(/-+$/g, '')
}

/**
 * First URL segments the app uses itself. Organization slugs can't take them,
 * because public event URLs are /{org-slug}/{event-slug} (D19).
 */
export const reservedSlugs = new Set([
	'about',
	'admin',
	'api',
	'app',
	'assets',
	'auth',
	'e',
	'events',
	'health',
	'help',
	'home',
	'invitations',
	'login',
	'logout',
	'm',
	'new',
	'polls',
	'privacy',
	'settings',
	'sign-in',
	'sign-out',
	'sign-up',
	'signup',
	'static',
	'terms',
])

/** Appends -2, -3, … until `taken` says the slug is free. */
export async function uniqueSlug(
	base: string,
	taken: (slug: string) => Promise<boolean>,
): Promise<string> {
	const root = base || 'event'
	if (!(await taken(root))) return root
	for (let n = 2; n < 1000; n++) {
		const candidate = `${root}-${n}`
		if (!(await taken(candidate))) return candidate
	}
	throw new Error('No free slug found')
}
