import { type AuditCategory, can, listAuditLog, listEvents, listMembers } from '@app/domain'
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { requireOrganizer } from './organizer'

/** The organization's audit log (owners only), with what the filters offer. */
export const getAuditLogFn = createServerFn({ method: 'GET' })
	.validator(
		(input: {
			eventId?: string
			category?: AuditCategory
			actorUserId?: string
			before?: string
		}) => input,
	)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		// Non-owners see the 404 page, as for anything else they can't reach.
		if (!can(ctx, { audit: ['read'] })) throw notFound()
		const [log, events, members] = await Promise.all([
			listAuditLog(db, ctx, data),
			listEvents(db, ctx),
			listMembers(db, ctx),
		])
		return {
			...log,
			events: events.map((e) => ({ id: e.id, name: e.name })),
			members: members.map((member) => ({ id: member.userId, name: member.name })),
		}
	})
