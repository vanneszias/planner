import type { Role } from '@app/auth/permissions'
import { type Db, schema } from '@app/db'
import { and, asc, eq, gt } from 'drizzle-orm'
import type { OrganizerContext } from './context.ts'

/*
 * Reads for the people screen (journeys.md, O3). Changes (invite, remove,
 * accept) go through Better Auth's organization plugin, which checks the same
 * roles from @app/auth/permissions.
 */

export async function listMembers(db: Db, ctx: OrganizerContext) {
	return db
		.select({
			memberId: schema.member.id,
			userId: schema.user.id,
			name: schema.user.name,
			email: schema.user.email,
			role: schema.member.role,
		})
		.from(schema.member)
		.innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
		.where(eq(schema.member.organizationId, ctx.organizationId))
		.orderBy(asc(schema.member.createdAt))
}

export async function listPendingInvitations(db: Db, ctx: OrganizerContext) {
	return db
		.select({
			id: schema.invitation.id,
			email: schema.invitation.email,
			role: schema.invitation.role,
			expiresAt: schema.invitation.expiresAt,
		})
		.from(schema.invitation)
		.where(
			and(
				eq(schema.invitation.organizationId, ctx.organizationId),
				eq(schema.invitation.status, 'pending'),
				gt(schema.invitation.expiresAt, new Date()),
			),
		)
		.orderBy(asc(schema.invitation.createdAt))
}

/** Organizations a user belongs to, for the organization switcher. */
export async function listUserOrganizations(db: Db, userId: string) {
	return db
		.select({
			id: schema.organization.id,
			name: schema.organization.name,
			role: schema.member.role,
		})
		.from(schema.member)
		.innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
		.where(eq(schema.member.userId, userId))
		.orderBy(asc(schema.organization.name))
}

/**
 * What the invitee sees before accepting. Only shown to the signed-in user the
 * invitation was sent to; anyone else learns nothing about the organization.
 */
export async function invitationFor(db: Db, invitationId: string, userEmail: string) {
	const [found] = await db
		.select({
			id: schema.invitation.id,
			email: schema.invitation.email,
			role: schema.invitation.role,
			status: schema.invitation.status,
			expiresAt: schema.invitation.expiresAt,
			organizationName: schema.organization.name,
			inviterName: schema.user.name,
		})
		.from(schema.invitation)
		.innerJoin(schema.organization, eq(schema.organization.id, schema.invitation.organizationId))
		.innerJoin(schema.user, eq(schema.user.id, schema.invitation.inviterId))
		.where(eq(schema.invitation.id, invitationId))
		.limit(1)
	if (!found) return { state: 'missing' as const }
	if (found.email.toLowerCase() !== userEmail.toLowerCase()) {
		return { state: 'other_email' as const, email: found.email }
	}
	if (found.status !== 'pending' || found.expiresAt < new Date()) {
		return { state: 'expired' as const }
	}
	return {
		state: 'open' as const,
		organizationName: found.organizationName,
		inviterName: found.inviterName,
		role: found.role as Role | null,
	}
}
