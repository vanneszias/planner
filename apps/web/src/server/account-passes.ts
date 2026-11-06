import { env } from 'cloudflare:workers'
import { createDb } from '@app/db'
import { linkRegistrations, passesFor, passToken } from '@app/domain'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { getAuth } from './auth'
import { openToken, passSvg } from './pass'

/*
 * Participant accounts (D29), server-only helpers: read the session, attach
 * registrations by verified email, and render passes as QR SVG. Kept out of
 * the server-function module so client bundles never see these imports.
 */

const db = () => createDb(env.DB)

/** The signed-in user, or null. Passes are shown only to the person they belong to. */
export async function signedInUser() {
	const session = await getAuth().api.getSession({ headers: getRequestHeaders() })
	return session?.user ?? null
}

/** Passes for an account, optionally limited to one event. Rendered as QR SVG. */
export async function accountPasses(
	user: { id: string; email: string; emailVerified: boolean },
	eventId?: string,
) {
	await linkRegistrations(db(), user)
	const passes = await passesFor(db(), user.id, openToken, eventId)
	return passes.map((pass) => ({
		registrationId: pass.registrationId,
		eventId: pass.eventId,
		eventName: pass.eventName,
		eventPath: `/${pass.organizationSlug}/${pass.eventSlug}`,
		displayName: pass.displayName,
		forChild: pass.forChild,
		qr: passSvg(pass.token),
	}))
}

/**
 * The pass of a participant recognised by their private link or code: they
 * already hold the link, so showing it as a QR reveals nothing new. Null when
 * the credential predates passes (the organizer issues new codes to get one).
 */
export async function linkPass(registrationId: string, displayName: string) {
	const token = await passToken(db(), registrationId, openToken)
	return token ? { registrationId, displayName, forChild: false, qr: passSvg(token) } : null
}
