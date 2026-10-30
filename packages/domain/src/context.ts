import { type Role, roles } from '@app/auth/permissions'
import type { Db } from '@app/db'
import { schema } from '@app/db'
import { and, eq } from 'drizzle-orm'
import { forbidden } from './errors.ts'

/**
 * Who is acting, and for which organization. Every organizer-side domain
 * function takes this; none accepts a bare organization or event ID
 * (docs/domain-model.md, "Access paths and tenant scoping").
 */
export type OrganizerContext = {
	userId: string
	organizationId: string
	role: Role
}

type Permission = {
	organization?: ('update' | 'delete')[]
	event?: ('create' | 'update' | 'delete' | 'allocate' | 'publish')[]
	participant?: ('read' | 'write' | 'export')[]
}

export function can(ctx: OrganizerContext, permission: Permission): boolean {
	return roles[ctx.role].authorize(permission).success
}

export function requirePermission(ctx: OrganizerContext, permission: Permission): void {
	if (!can(ctx, permission)) throw forbidden()
}

/** Builds the context from a membership row; null when the user isn't a member. */
export async function organizerContext(
	db: Db,
	userId: string,
	organizationId: string,
): Promise<OrganizerContext | null> {
	const [membership] = await db
		.select({ role: schema.member.role })
		.from(schema.member)
		.where(and(eq(schema.member.userId, userId), eq(schema.member.organizationId, organizationId)))
		.limit(1)
	if (!membership || !(membership.role in roles)) return null
	return { userId, organizationId, role: membership.role as Role }
}
