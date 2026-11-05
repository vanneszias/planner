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

/*
 * Passes: the private link token is also kept encrypted, so a signed-in
 * participant can see their own QR again. Only the link token is sealed; the
 * hash stays the lookup key. Encryption key: PARTICIPANT_TOKEN_KEY (32 random
 * bytes, base64), a Worker secret. Anonymisation clears the sealed copy.
 */

export type SealToken = (token: string) => Promise<string>
export type OpenToken = (sealed: string) => Promise<string | null>

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

/** AES-256-GCM key from the base64 secret. Throws on a wrong length, so a bad secret fails loudly. */
export async function importTokenKey(base64: string): Promise<CryptoKey> {
	const raw = fromBase64(base64)
	if (raw.length !== 32) throw new Error('PARTICIPANT_TOKEN_KEY must be 32 bytes, base64-encoded')
	return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/** A random 12-byte IV, stored in front of the ciphertext. */
export async function sealWith(key: CryptoKey, token: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12))
	const data = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)),
	)
	const out = new Uint8Array(iv.length + data.length)
	out.set(iv)
	out.set(data, iv.length)
	return toBase64(out)
}

/** Null if the value was tampered with or sealed under another key. */
export async function openWith(key: CryptoKey, sealed: string): Promise<string | null> {
	try {
		const bytes = fromBase64(sealed)
		const plain = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: bytes.slice(0, 12) },
			key,
			bytes.slice(12),
		)
		return new TextDecoder().decode(plain)
	} catch {
		return null
	}
}
