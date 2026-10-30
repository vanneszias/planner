import { env } from 'cloudflare:workers'
import { createDb } from '@app/db'
import {
	getOrganization,
	invitationFor,
	listMembers,
	listPendingInvitations,
	listUserOrganizations,
} from '@app/domain'
import { redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { getAuth } from './auth'
import { requireOrganizer } from './organizer'

/** The team screen. Only owners may invite or remove (D14); Better Auth enforces it too. */
export const getTeam = createServerFn({ method: 'GET' }).handler(async () => {
	const { db, ctx } = await requireOrganizer()
	const [organization, members, invitations] = await Promise.all([
		getOrganization(db, ctx.organizationId),
		listMembers(db, ctx),
		listPendingInvitations(db, ctx),
	])
	return {
		organization,
		members,
		invitations,
		currentUserId: ctx.userId,
		canManage: ctx.role === 'owner',
	}
})

/** For the header switcher: every organization the user belongs to, and the current one. */
export const getMyOrganizations = createServerFn({ method: 'GET' }).handler(async () => {
	const { db, ctx } = await requireOrganizer()
	return {
		organizations: await listUserOrganizations(db, ctx.userId),
		activeId: ctx.organizationId,
	}
})

/** The invitation page. Signed-out visitors go to sign-in and come back here. */
export const getInvitation = createServerFn({ method: 'GET' })
	.validator((invitationId: string) => invitationId)
	.handler(async ({ data: invitationId }) => {
		const session = await getAuth().api.getSession({ headers: getRequestHeaders() })
		if (!session) {
			throw redirect({ to: '/sign-in', search: { redirect: `/invitations/${invitationId}` } })
		}
		return invitationFor(createDb(env.DB), invitationId, session.user.email)
	})
