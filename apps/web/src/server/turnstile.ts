import { env } from 'cloudflare:workers'
import { getRequestHeader } from '@tanstack/react-start/server'

/**
 * Server-side Turnstile check (security-privacy.md, "Turnstile placement").
 * Without a configured secret it passes and logs once: production keys are a
 * pre-pilot checklist item. Locally, .dev.vars uses Cloudflare's test keys.
 */
let warned = false

export async function verifyTurnstile(token: string | undefined): Promise<boolean> {
	if (!env.TURNSTILE_SECRET) {
		if (!warned) console.warn('Turnstile secret not set: skipping bot checks')
		warned = true
		return true
	}
	if (!token) return false
	const body = new FormData()
	body.append('secret', env.TURNSTILE_SECRET)
	body.append('response', token)
	const ip = getRequestHeader('CF-Connecting-IP')
	if (ip) body.append('remoteip', ip)
	const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
		method: 'POST',
		body,
	})
	const result = (await response.json()) as { success?: boolean }
	return result.success === true
}
