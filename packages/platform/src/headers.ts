/*
 * Security headers (security-privacy.md, "Browser hardening"). `web` adds a
 * CSP with a nonce on top; the other Workers serve no HTML, so they lock
 * everything down. HSTS waits for the final domain (*.workers.dev is on the
 * .dev HSTS preload list already).
 */

export const baseSecurityHeaders: Record<string, string> = {
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Permissions-Policy':
		'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
	'Cross-Origin-Opener-Policy': 'same-origin',
	'X-Frame-Options': 'DENY',
}

/** For Workers that never serve pages: nothing may load, frame or refer. */
export const apiSecurityHeaders: Record<string, string> = {
	...baseSecurityHeaders,
	'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
	'Referrer-Policy': 'no-referrer',
}

/** A copy of the response with the headers set (responses from fetch() are immutable). */
export function withHeaders(response: Response, headers: Record<string, string>): Response {
	// WebSocket upgrades must pass through untouched.
	if (response.status === 101) return response
	const copy = new Response(response.body, response)
	for (const [name, value] of Object.entries(headers)) {
		if (!copy.headers.has(name)) copy.headers.set(name, value)
	}
	return copy
}
