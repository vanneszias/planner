import { env } from 'cloudflare:workers'
import { brand } from '@app/brand'
import type { Db } from '@app/db'
import { respondentStamp } from '@app/domain'
import { getCookie, getRequestUrl, setCookie } from '@tanstack/react-start/server'
import { equal, hmac } from './participant-session'

/*
 * The poll guest cookie: "<respondentId>.<signature>", signed over the
 * respondent's edit-token hash, like the participant cookie.
 */

export const cookieName = (pollId: string) => `${brand.slug}.v.${pollId}`
const cookieMaxAge = 60 * 60 * 24 * 120

export const editLink = (token: string) => `${env.BETTER_AUTH_URL}/m/r/${token}`

/** Sets the guest cookie, signed over the respondent's current edit-token hash. */
export async function setRespondentCookie(db: Db, pollId: string, respondentId: string) {
	const stamp = await respondentStamp(db, respondentId)
	if (!stamp) return
	setCookie(cookieName(pollId), `${respondentId}.${await hmac(`poll:${respondentId}:${stamp}`)}`, {
		httpOnly: true,
		secure: getRequestUrl().protocol === 'https:',
		sameSite: 'lax',
		path: '/',
		maxAge: cookieMaxAge,
	})
}

export async function cookieRespondent(db: Db, pollId: string): Promise<string | null> {
	const [respondentId, mac] = getCookie(cookieName(pollId))?.split('.') ?? []
	if (!respondentId || !mac) return null
	const stamp = await respondentStamp(db, respondentId)
	if (!stamp || !equal(mac, await hmac(`poll:${respondentId}:${stamp}`))) return null
	return respondentId
}
