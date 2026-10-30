/**
 * Where to go after signing in. Only same-site paths: "/x" yes, "//evil.com"
 * and "https://…" no, so the parameter can't be used for open redirects.
 */
export function safeRedirect(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined
	if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return undefined
	return value
}
