import type { AllocationInput } from './types.ts'

/** JSON with sorted object keys, so equal inputs always serialize identically. */
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
	}
	return JSON.stringify(value)
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * SHA-256 of the input in a canonical form: participant, session and locked
 * order don't change the hash (they don't change the result either).
 * Stored with each run to prove which snapshot produced it.
 */
export async function inputHash(input: AllocationInput): Promise<string> {
	const normalized = {
		...input,
		participants: [...input.participants].sort(byId),
		sessions: [...input.sessions].sort(byId),
		locked: [...(input.locked ?? [])].sort(
			(a, b) =>
				a.participantId.localeCompare(b.participantId) || a.sessionId.localeCompare(b.sessionId),
		),
	}
	const bytes = new TextEncoder().encode(canonical(normalized))
	const digest = await crypto.subtle.digest('SHA-256', bytes)
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
