import { type Db, schema } from '@app/db'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { invalid, notFound } from './errors.ts'
import {
	accessTokenHash,
	newAccessToken,
	newShortCode,
	type OpenToken,
	type SealToken,
	shortCodeHash,
} from './tokens.ts'
import { parse } from './validation.ts'

/**
 * A participant acting on their own registration: from a private link, a
 * short code, or (later) a signed-in account. Never mixed with organizer
 * context (docs/domain-model.md).
 */
export type ParticipantContext = {
	registrationId: string
	eventId: string
	organizationId: string
}

export const selfRegistrationInput = z.object({
	name: z.string().trim().min(1, 'required').max(80, 'too_long'),
	email: z.string().trim().toLowerCase().max(254, 'too_long').pipe(z.email('email')),
	ageGroupId: z.string().optional(),
})
export type SelfRegistrationInput = z.input<typeof selfRegistrationInput>

export type NewCredentials = { token: string; code: string }

/** A published event's id and owner, for public actions. Null if not open to the public. */
async function publicEvent(db: Db, eventId: string) {
	const [found] = await db
		.select({
			id: schema.event.id,
			organizationId: schema.event.organizationId,
			status: schema.event.status,
		})
		.from(schema.event)
		.where(eq(schema.event.id, eventId))
		.limit(1)
	return found?.status === 'published' ? found : null
}

/**
 * Adult self-registration (journeys.md, P1; D23: no email round trip before
 * booking). If the email is already registered for this event, nothing is
 * created and `existing` is returned so the caller can re-send that person's
 * link; the screen shows the same neutral message either way.
 */
export async function registerSelf(
	db: Db,
	eventId: string,
	input: SelfRegistrationInput,
	seal?: SealToken,
): Promise<
	| { kind: 'created'; context: ParticipantContext; credentials: NewCredentials }
	| { kind: 'existing'; registrationId: string }
> {
	const values = parse(selfRegistrationInput, input)
	const event = await publicEvent(db, eventId)
	if (!event) throw notFound('Event')

	if (values.ageGroupId) {
		const [group] = await db
			.select({ id: schema.ageGroup.id })
			.from(schema.ageGroup)
			.where(and(eq(schema.ageGroup.id, values.ageGroupId), eq(schema.ageGroup.eventId, eventId)))
			.limit(1)
		if (!group) throw invalid({ ageGroupId: 'not_found' })
	}

	const [existing] = await db
		.select({ id: schema.registration.id })
		.from(schema.registration)
		.where(
			and(eq(schema.registration.eventId, eventId), eq(schema.registration.email, values.email)),
		)
		.limit(1)
	if (existing) return { kind: 'existing', registrationId: existing.id }

	const credentials = { token: newAccessToken(), code: newShortCode() }
	const [created] = await db
		.insert(schema.registration)
		.values({
			organizationId: event.organizationId,
			eventId,
			registeredBy: 'self',
			displayName: values.name,
			email: values.email,
			ageGroupId: values.ageGroupId ?? null,
			accessTokenHash: await accessTokenHash(credentials.token),
			accessTokenSealed: seal ? await seal(credentials.token) : null,
			shortCodeHash: await shortCodeHash(eventId, credentials.code),
		})
		.returning({ id: schema.registration.id })
	if (!created) throw new Error('Registration insert returned nothing')
	return {
		kind: 'created',
		context: { registrationId: created.id, eventId, organizationId: event.organizationId },
		credentials,
	}
}

/** Resolves a private link token. Null if unknown, cancelled or anonymised. */
export async function contextFromToken(db: Db, token: string): Promise<ParticipantContext | null> {
	if (!token || token.length > 64) return null
	const [found] = await db
		.select({
			registrationId: schema.registration.id,
			eventId: schema.registration.eventId,
			organizationId: schema.registration.organizationId,
			status: schema.registration.status,
		})
		.from(schema.registration)
		.where(eq(schema.registration.accessTokenHash, await accessTokenHash(token)))
		.limit(1)
	if (found?.status !== 'active') return null
	return {
		registrationId: found.registrationId,
		eventId: found.eventId,
		organizationId: found.organizationId,
	}
}

/** Resolves a short code for one event. The caller then sets the same cookie a link would. */
export async function contextFromCode(
	db: Db,
	eventId: string,
	code: string,
): Promise<ParticipantContext | null> {
	if (code.replace(/[\s-]/g, '').length !== 6) return null
	const [found] = await db
		.select({
			registrationId: schema.registration.id,
			organizationId: schema.registration.organizationId,
			status: schema.registration.status,
		})
		.from(schema.registration)
		.where(
			and(
				eq(schema.registration.eventId, eventId),
				eq(schema.registration.shortCodeHash, await shortCodeHash(eventId, code)),
			),
		)
		.limit(1)
	if (found?.status !== 'active') return null
	return { registrationId: found.registrationId, eventId, organizationId: found.organizationId }
}

/**
 * Issues a new link token for a registration and invalidates the old one.
 * Used when a link is lost or leaked, and when resending a link by email
 * (the old token can't be recovered from its hash).
 */
export async function rotateAccessToken(
	db: Db,
	registrationId: string,
	seal?: SealToken,
): Promise<string> {
	const token = newAccessToken()
	await db
		.update(schema.registration)
		.set({
			accessTokenHash: await accessTokenHash(token),
			accessTokenSealed: seal ? await seal(token) : null,
		})
		.where(eq(schema.registration.id, registrationId))
	return token
}

/**
 * The participant's own pass token, opened. Null when the credential was issued
 * before passes existed (then the organizer issues new codes to get one).
 */
export async function passToken(
	db: Db,
	registrationId: string,
	open: OpenToken,
): Promise<string | null> {
	const [found] = await db
		.select({ sealed: schema.registration.accessTokenSealed })
		.from(schema.registration)
		.where(eq(schema.registration.id, registrationId))
		.limit(1)
	return found?.sealed ? open(found.sealed) : null
}

/**
 * The value a participant cookie is bound to: the current link token hash.
 * Rotating the token changes it, which logs out every existing cookie.
 */
export async function credentialStamp(db: Db, registrationId: string): Promise<string | null> {
	const [found] = await db
		.select({ hash: schema.registration.accessTokenHash, status: schema.registration.status })
		.from(schema.registration)
		.where(eq(schema.registration.id, registrationId))
		.limit(1)
	return found?.status === 'active' ? found.hash : null
}

/** Who the participant is, for their own screens and emails. */
export async function getRegistration(db: Db, context: ParticipantContext) {
	const [found] = await db
		.select({
			id: schema.registration.id,
			displayName: schema.registration.displayName,
			email: schema.registration.email,
			guardianEmail: schema.registration.guardianEmail,
			ageGroupId: schema.registration.ageGroupId,
		})
		.from(schema.registration)
		.where(
			and(
				eq(schema.registration.id, context.registrationId),
				eq(schema.registration.eventId, context.eventId),
			),
		)
		.limit(1)
	if (!found) throw notFound('Registration')
	return found
}
