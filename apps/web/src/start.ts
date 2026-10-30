import { createCsrfMiddleware, createStart } from '@tanstack/react-start'

/**
 * CSRF (security-privacy.md, "Authentication"): on top of SameSite=Lax
 * cookies, every state-changing request must come from this origin
 * (Sec-Fetch-Site, then Origin, then Referer). Page loads and links from
 * elsewhere (GET) stay allowed.
 */
export const startInstance = createStart(() => ({
	requestMiddleware: [
		createCsrfMiddleware({
			filter: ({ request }) => !['GET', 'HEAD', 'OPTIONS'].includes(request.method),
		}),
	],
}))
