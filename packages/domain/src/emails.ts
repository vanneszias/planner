import { type Db, schema } from '@app/db'
import { chunk, rowsPerInsert } from './d1-limits.ts'

export type EmailClaim = {
	organizationId: string
	eventId: string
	registrationId: string
	kind: string
	key: string
}

/**
 * Claims an email before sending it, so a retried request or redelivered
 * queue message never sends twice (security-privacy.md). Returns false if
 * this key was already claimed. Recipient addresses are not stored here.
 */
export async function claimEmail(db: Db, email: EmailClaim): Promise<boolean> {
	return (await claimEmails(db, [email])).has(email.key)
}

/** Claims many emails in one D1 batch; returns the keys claimed now (not earlier). */
export async function claimEmails(db: Db, emails: readonly EmailClaim[]): Promise<Set<string>> {
	const [first, ...rest] = chunk(emails, rowsPerInsert(11)).map((group) =>
		db
			.insert(schema.emailDelivery)
			.values(
				group.map((email) => ({
					organizationId: email.organizationId,
					eventId: email.eventId,
					registrationId: email.registrationId,
					kind: email.kind,
					idempotencyKey: email.key,
				})),
			)
			.onConflictDoNothing()
			.returning({ key: schema.emailDelivery.idempotencyKey }),
	)
	if (!first) return new Set()
	const results = await db.batch([first, ...rest])
	return new Set(results.flat().map((r) => r.key))
}
