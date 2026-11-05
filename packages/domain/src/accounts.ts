import { type Db, schema } from '@app/db'
import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { publicEventMeta } from './public.ts'
import type { OpenToken } from './tokens.ts'

/*
 * Participant accounts (D29, journeys.md P4). An account is an ordinary
 * sign-in; it owns no data of its own. Registrations attach to it by verified
 * email: the person's own registration (userId) and, for a guardian, the
 * minors registered under the guardian's email (managedByUserId, D24).
 * Attaching is idempotent and runs whenever the signed-in person looks.
 */

export type AccountUser = { id: string; email: string; emailVerified: boolean }

/** Attaches unattached registrations that match the account's verified email. */
export async function linkRegistrations(db: Db, user: AccountUser): Promise<void> {
	if (!user.emailVerified) return // An unverified email could belong to someone else.
	const email = user.email.trim().toLowerCase()
	const live = and(
		eq(schema.registration.status, 'active'),
		isNull(schema.registration.anonymisedAt),
	)
	await db
		.update(schema.registration)
		.set({ userId: user.id })
		.where(
			and(
				sql`lower(${schema.registration.email}) = ${email}`,
				isNull(schema.registration.userId),
				live,
			),
		)
	await db
		.update(schema.registration)
		.set({ managedByUserId: user.id })
		.where(
			and(
				sql`lower(${schema.registration.guardianEmail}) = ${email}`,
				isNull(schema.registration.managedByUserId),
				live,
			),
		)
}

export type Pass = {
	registrationId: string
	eventId: string
	eventName: string
	eventSlug: string
	organizationSlug: string
	displayName: string
	/** True for a child attached through a guardian's email. */
	forChild: boolean
	token: string
}

/**
 * Passes the account can show: their own, and their minors' (optionally for one event).
 * Anonymised, cancelled or unpublished events drop out; tokens that can't be opened drop out too.
 */
export async function passesFor(
	db: Db,
	userId: string,
	open: OpenToken,
	eventId?: string,
): Promise<Pass[]> {
	const rows = await db
		.select({
			registrationId: schema.registration.id,
			eventId: schema.registration.eventId,
			displayName: schema.registration.displayName,
			ownUserId: schema.registration.userId,
			sealed: schema.registration.accessTokenSealed,
		})
		.from(schema.registration)
		.where(
			and(
				or(eq(schema.registration.userId, userId), eq(schema.registration.managedByUserId, userId)),
				eventId ? eq(schema.registration.eventId, eventId) : undefined,
				eq(schema.registration.status, 'active'),
				isNull(schema.registration.anonymisedAt),
				isNotNull(schema.registration.accessTokenSealed),
			),
		)
	const passes: Pass[] = []
	for (const row of rows) {
		if (!row.sealed) continue
		const token = await open(row.sealed)
		const event = await publicEventMeta(db, row.eventId)
		if (!token || !event) continue
		passes.push({
			registrationId: row.registrationId,
			eventId: row.eventId,
			eventName: event.name,
			eventSlug: event.slug,
			organizationSlug: event.organizationSlug,
			displayName: row.displayName,
			forChild: row.ownUserId !== userId,
			token,
		})
	}
	return passes.sort(
		(a, b) => a.eventName.localeCompare(b.eventName) || a.displayName.localeCompare(b.displayName),
	)
}
