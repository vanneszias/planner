import { baseSecurityHeaders } from '@app/platform'

/*
 * Content Security Policy (security-privacy.md, "Browser hardening"). Scripts
 * run only with this response's nonce; 'strict-dynamic' lets those load the
 * app's chunks and Turnstile. React writes style attributes, so styles allow
 * inline. Turnstile's frame is the only third-party content.
 */

export const nonceHeader = 'x-csp-nonce'

export function newNonce(): string {
	return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))))
}

export function contentSecurityPolicy(nonce: string, origin: string): string {
	const socket = origin.replace(/^http/, 'ws')
	return [
		"default-src 'self'",
		`script-src 'nonce-${nonce}' 'strict-dynamic' 'self' https://challenges.cloudflare.com`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self'",
		`connect-src 'self' ${socket}`,
		'frame-src https://challenges.cloudflare.com',
		"frame-ancestors 'none'",
		"base-uri 'none'",
		"form-action 'self'",
		"object-src 'none'",
	].join('; ')
}

/** The response with security headers, and the CSP when it's a page. */
export function secureResponse(response: Response, nonce: string, origin: string): Response {
	// WebSocket upgrades must pass through untouched.
	if (response.status === 101) return response
	const secured = new Response(response.body, response)
	for (const [name, value] of Object.entries(baseSecurityHeaders)) {
		if (!secured.headers.has(name)) secured.headers.set(name, value)
	}
	if (secured.headers.get('Content-Type')?.startsWith('text/html')) {
		secured.headers.set('Content-Security-Policy', contentSecurityPolicy(nonce, origin))
	}
	return secured
}
