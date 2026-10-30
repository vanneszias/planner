/*
 * Participant credentials (D16, security-privacy.md). Only hashes are stored;
 * the token and code exist in the link, the QR code and the email.
 */

/** Crockford base32 without I, L, O, U: nothing that reads as another character. */
const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** 128 random bits, URL-safe base64 (22 characters). */
export function newAccessToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16))
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '')
}

/** Six characters shown as "K7Q2-XA": about a billion combinations, valid only with its event. */
export function newShortCode(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(6))
	const chars = Array.from(bytes, (b) => alphabet[b % 32]).join('')
	return `${chars.slice(0, 4)}-${chars.slice(4)}`
}

/**
 * What people type is forgiven: case, dashes and spaces don't matter, and the
 * letters Crockford leaves out map to the digits they look like.
 */
export function normalizeShortCode(input: string): string {
	return input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
}

export const accessTokenHash = (token: string) => sha256(`access:${token}`)
export const shortCodeHash = (eventId: string, code: string) =>
	sha256(`code:${eventId}:${normalizeShortCode(code)}`)
