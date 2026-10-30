/**
 * UUIDv7 (RFC 9562): 48-bit millisecond timestamp, then random bits. Sorts by
 * creation time, which keeps indexes compact, and is never derived from names,
 * so it's safe as a Durable Object name (docs/domain-model.md).
 */
export function uuidv7(now = Date.now()): string {
	const bytes = new Uint8Array(16)
	crypto.getRandomValues(bytes)

	let timestamp = now
	for (let i = 5; i >= 0; i--) {
		bytes[i] = timestamp % 256
		timestamp = Math.floor(timestamp / 256)
	}
	bytes[6] = 0x70 | ((bytes[6] as number) & 0x0f) // version 7
	bytes[8] = 0x80 | ((bytes[8] as number) & 0x3f) // RFC 9562 variant

	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
