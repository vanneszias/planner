import { env } from 'cloudflare:workers'
import { getRequestHeader } from '@tanstack/react-start/server'

/*
 * Abuse damping with the Workers rate limiting binding (security-privacy.md,
 * "Rate limits"). Counters are per Cloudflare location and approximate, which
 * suits this. IP keys are always combined with the event: a school group on
 * one Wi-Fi shares an IP.
 */

const limiters = {
	register: () => env.LIMIT_REGISTER,
	code: () => env.LIMIT_CODE,
	findEmail: () => env.LIMIT_FIND_EMAIL,
	findIp: () => env.LIMIT_FIND_IP,
	booking: () => env.LIMIT_BOOKING,
	ranking: () => env.LIMIT_RANKING,
	bulk: () => env.LIMIT_BULK,
	live: () => env.LIMIT_LIVE,
}

/** False when the caller is over the limit for this key. */
export async function withinLimit(limit: keyof typeof limiters, key: string): Promise<boolean> {
	const { success } = await limiters[limit]().limit({ key: `${limit}:${key}` })
	return success
}

export const clientIp = () => getRequestHeader('CF-Connecting-IP') ?? 'unknown'
