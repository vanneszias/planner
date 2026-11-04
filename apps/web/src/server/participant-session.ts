import { env } from 'cloudflare:workers'
import { brand } from '@app/brand'
import { createDb } from '@app/db'
import { credentialStamp, type ParticipantContext } from '@app/domain'
import { getCookie, getRequestUrl, setCookie } from '@tanstack/react-start/server'

/*
 * The participant cookie (security-privacy.md): the private link token is
 * exchanged for this on first use, so the token leaves the URL immediately.
 * Value: "<registrationId>.<signature>", signed over the registration's
 * current link hash, so rotating the link logs out every existing cookie.
 */

const cookieName = (eventId: string) => `${brand.slug}.p.${eventId}`
const maxAge = 60 * 60 * 24 * 180

/** HMAC-SHA-256 with the app secret, URL-safe base64. Also signs poll respondent cookies. */
export async function hmac(text: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(env.BETTER_AUTH_SECRET),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	)
	const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))
	return btoa(String.fromCharCode(...new Uint8Array(mac)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '')
}

const signature = (registrationId: string, stamp: string) =>
	hmac(`participant:${registrationId}:${stamp}`)

/** Constant-time comparison, so signatures can't be guessed byte by byte. */
export function equal(a: string, b: string): boolean {
	if (a.length !== b.length) return false
	let diff = 0
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
	return diff === 0
}

export async function setParticipantCookie(context: ParticipantContext): Promise<void> {
	const stamp = await credentialStamp(createDb(env.DB), context.registrationId)
	if (!stamp) return
	setCookie(
		cookieName(context.eventId),
		`${context.registrationId}.${await signature(context.registrationId, stamp)}`,
		{
			httpOnly: true,
			secure: getRequestUrl().protocol === 'https:',
			sameSite: 'lax',
			path: '/',
			maxAge,
		},
	)
}

/** The participant for this event, from their cookie; null if absent, tampered or revoked. */
export async function readParticipant(
	eventId: string,
	organizationId: string,
): Promise<ParticipantContext | null> {
	const value = getCookie(cookieName(eventId))
	if (!value) return null
	const [registrationId, mac] = value.split('.')
	if (!registrationId || !mac) return null
	const stamp = await credentialStamp(createDb(env.DB), registrationId)
	if (!stamp || !equal(mac, await signature(registrationId, stamp))) return null
	return { registrationId, eventId, organizationId }
}
