import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements } from 'better-auth/plugins/organization/access'

/**
 * Organization roles (docs/decisions.md, D14). Statements merge Better Auth's
 * defaults (organization, member, invitation, …) with our resources.
 */
const statement = {
	...defaultStatements,
	event: ['create', 'update', 'delete', 'allocate', 'publish'],
	participant: ['read', 'write', 'export'],
	audit: ['read'],
} as const

export const ac = createAccessControl(statement)

export const owner = ac.newRole({
	organization: ['update', 'delete'],
	member: ['create', 'update', 'delete'],
	invitation: ['create', 'cancel'],
	event: ['create', 'update', 'delete', 'allocate', 'publish'],
	participant: ['read', 'write', 'export'],
	// Who did what in the organization: owners only.
	audit: ['read'],
})

/** Changes events and runs allocations. Can't manage people or delete the organization. */
export const editor = ac.newRole({
	event: ['create', 'update', 'delete', 'allocate', 'publish'],
	participant: ['read', 'write', 'export'],
})

/** Sees participants and exports lists. Read-only otherwise; access is audit-logged. */
export const viewer = ac.newRole({
	participant: ['read', 'export'],
})

export const roles = { owner, editor, viewer }
export type Role = keyof typeof roles
