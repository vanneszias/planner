/*
 * Seeded randomness: the same seed always gives the same order, so a run can
 * be reproduced exactly from its stored seed.
 */

/** 32-bit hash of a string (cyrb53, folded). Only used to turn a seed into a number. */
function hashSeed(seed: string): number {
	let h1 = 0xdeadbeef
	let h2 = 0x41c6ce57
	for (let i = 0; i < seed.length; i++) {
		const ch = seed.charCodeAt(i)
		h1 = Math.imul(h1 ^ ch, 2654435761)
		h2 = Math.imul(h2 ^ ch, 1597334677)
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
	return (h1 ^ h2) >>> 0
}

/** mulberry32: small, fast, good enough for shuffling. Returns values in [0, 1). */
export function seededRandom(seed: string): () => number {
	let state = hashSeed(seed)
	return () => {
		state = (state + 0x6d2b79f5) >>> 0
		let t = state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/** Fisher–Yates shuffle into a new array. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
	const result = [...items]
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1))
		;[result[i], result[j]] = [result[j] as T, result[i] as T]
	}
	return result
}
