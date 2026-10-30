import { env } from 'cloudflare:workers'
import { createDb, type Db } from '@app/db'
import {
	createPersonalOrganization,
	DomainError,
	type DomainErrorCode,
	defaultOrganizationId,
	type OrganizerContext,
	organizerContext,
} from '@app/domain'
import { redirect } from '@tanstack/react-router'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { getAuth } from './auth'
import { withinLimit } from './rate-limit'

/**
 * Resolves the signed-in organizer and their organization for a server
 * function. Redirects to sign-in when there's no session. Server-only.
 */
export async function requireOrganizer(): Promise<{ db: Db; ctx: OrganizerContext }> {
	const session = await getAuth().api.getSession({ headers: getRequestHeaders() })
	if (!session) throw redirect({ to: '/sign-in' })

	const db = createDb(env.DB)
	const userId = session.user.id
	const organizationId =
		session.session.activeOrganizationId ??
		(await defaultOrganizationId(db, userId)) ??
		// Accounts created before personal organizations existed.
		(await createPersonalOrganization(db, session.user))

	const ctx = await organizerContext(db, userId, organizationId)
	if (!ctx) throw redirect({ to: '/sign-in' })
	return { db, ctx }
}

/** What a mutation returns to a form: data, or an error code with per-field issue codes. */
export type ActionResult<T> =
	| { ok: true; data: T }
	| { ok: false; code: DomainErrorCode; issues?: Record<string, string> }

export async function action<T>(run: () => Promise<T>): Promise<ActionResult<T>> {
	try {
		return { ok: true, data: await run() }
	} catch (error) {
		if (error instanceof DomainError) return { ok: false, code: error.code, issues: error.issues }
		throw error
	}
}

/** Bulk work (CSV import, exports, code cards, guardian emails): 5 a minute per organization. */
export async function limitBulk(ctx: OrganizerContext): Promise<void> {
	if (!(await withinLimit('bulk', ctx.organizationId))) {
		throw new DomainError('rate_limited', 'Too many requests')
	}
}

/**
 * Sensitive actions (anonymising an event) need a sign-in under 12 hours old
 * (security-privacy.md, "Authentication").
 */
export async function requireFreshSignIn(): Promise<void> {
	const session = await getAuth().api.getSession({ headers: getRequestHeaders() })
	const age = session ? Date.now() - new Date(session.session.createdAt).getTime() : Infinity
	if (age > 12 * 60 * 60 * 1000) throw new DomainError('reauthenticate', 'Sign in again')
}
