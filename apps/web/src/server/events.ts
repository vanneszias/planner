import {
	type CreateEventInput,
	type CreateSessionsInput,
	can,
	createEvent,
	createSessions,
	createWorkshop,
	DomainError,
	deleteSession,
	deleteWorkshop,
	type Event,
	getEvent,
	getOrganization,
	listEvents,
	listSessions,
	listWorkshops,
	roomConflicts,
	setEventStatus,
	type UpdateEventInput,
	type UpdateSessionInput,
	updateEvent,
	updateSession,
	updateWorkshop,
	utcToZoned,
	type WorkshopInput,
} from '@app/domain'
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { action, requireOrganizer } from './organizer'

/*
 * Organizer-side server functions. Each resolves the organizer context first;
 * the domain functions then check the role and scope every query to the
 * organization (docs/domain-model.md).
 */

export const getDashboard = createServerFn({ method: 'GET' }).handler(async () => {
	const { db, ctx } = await requireOrganizer()
	const [organization, events] = await Promise.all([
		getOrganization(db, ctx.organizationId),
		listEvents(db, ctx),
	])
	return { organization, events, canCreate: can(ctx, { event: ['create'] }) }
})

export const createEventFn = createServerFn({ method: 'POST' })
	.validator((input: CreateEventInput) => input)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return action(() => createEvent(db, ctx, data))
	})

/** Everything the event screens need in one round trip. */
export const getEventOverview = createServerFn({ method: 'GET' })
	.validator((eventId: string) => eventId)
	.handler(async ({ data: eventId }) => {
		const { db, ctx } = await requireOrganizer()
		// Another organization's event looks exactly like a missing one: the 404 page.
		const event = await getEvent(db, ctx, eventId).catch((error) => {
			if (error instanceof DomainError && error.code === 'not_found') throw notFound()
			throw error
		})
		const [workshops, sessions, organization] = await Promise.all([
			listWorkshops(db, ctx, eventId),
			listSessions(db, ctx, eventId),
			getOrganization(db, ctx.organizationId),
		])
		return {
			event,
			workshops,
			sessions,
			conflicts: roomConflicts(sessions),
			// The window as the organizer entered it, in the event's timezone.
			window: {
				opens: event.opensAt ? utcToZoned(event.opensAt, event.timezone) : null,
				closes: event.closesAt ? utcToZoned(event.closesAt, event.timezone) : null,
			},
			organizationSlug: organization?.slug ?? '',
			canEdit: can(ctx, { event: ['update'] }),
			canPublish: can(ctx, { event: ['publish'] }),
		}
	})

export const updateEventFn = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string; values: UpdateEventInput }) => input)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return action(() => updateEvent(db, ctx, data.eventId, data.values))
	})

export const setEventStatusFn = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string; status: Event['status'] }) => input)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return action(() => setEventStatus(db, ctx, data.eventId, data.status))
	})

export const saveWorkshopFn = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string; workshopId?: string; values: WorkshopInput }) => input)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return action(() =>
			data.workshopId
				? updateWorkshop(db, ctx, data.workshopId, data.values)
				: createWorkshop(db, ctx, data.eventId, data.values),
		)
	})

export const deleteWorkshopFn = createServerFn({ method: 'POST' })
	.validator((workshopId: string) => workshopId)
	.handler(async ({ data: workshopId }) => {
		const { db, ctx } = await requireOrganizer()
		return action(() => deleteWorkshop(db, ctx, workshopId))
	})

export const createSessionsFn = createServerFn({ method: 'POST' })
	.validator((input: { eventId: string; values: CreateSessionsInput }) => input)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return action(() => createSessions(db, ctx, data.eventId, data.values))
	})

export const updateSessionFn = createServerFn({ method: 'POST' })
	.validator((input: { sessionId: string; values: UpdateSessionInput }) => input)
	.handler(async ({ data }) => {
		const { db, ctx } = await requireOrganizer()
		return action(() => updateSession(db, ctx, data.sessionId, data.values))
	})

export const deleteSessionFn = createServerFn({ method: 'POST' })
	.validator((sessionId: string) => sessionId)
	.handler(async ({ data: sessionId }) => {
		const { db, ctx } = await requireOrganizer()
		return action(() => deleteSession(db, ctx, sessionId))
	})
