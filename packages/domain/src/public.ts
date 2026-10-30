import { type Db, schema } from '@app/db'
import { and, asc, eq, inArray } from 'drizzle-orm'

/**
 * The public event page: published (or closed) events only, no organizer
 * context, and only fields a participant may see.
 */
export async function getPublicEvent(db: Db, orgSlug: string, eventSlug: string) {
	const [found] = await db
		.select({
			id: schema.event.id,
			organizationId: schema.event.organizationId,
			organizationName: schema.organization.name,
			name: schema.event.name,
			description: schema.event.description,
			timezone: schema.event.timezone,
			startsOn: schema.event.startsOn,
			endsOn: schema.event.endsOn,
			status: schema.event.status,
			mode: schema.event.mode,
			defaultLocale: schema.event.defaultLocale,
			accentColor: schema.event.accentColor,
			opensAt: schema.event.opensAt,
			closesAt: schema.event.closesAt,
			sessionsPerParticipant: schema.event.sessionsPerParticipant,
			changeCutoff: schema.event.changeCutoff,
			rankLimit: schema.event.rankLimit,
			rankMinimum: schema.event.rankMinimum,
			showTimesWhileRanking: schema.event.showTimesWhileRanking,
		})
		.from(schema.event)
		.innerJoin(schema.organization, eq(schema.organization.id, schema.event.organizationId))
		.where(
			and(
				eq(schema.organization.slug, orgSlug),
				eq(schema.event.slug, eventSlug),
				inArray(schema.event.status, ['published', 'closed']),
			),
		)
		.limit(1)
	if (!found) return null

	const [workshops, sessions] = await Promise.all([
		db
			.select({
				id: schema.workshop.id,
				title: schema.workshop.title,
				description: schema.workshop.description,
				facilitatorName: schema.workshop.facilitatorName,
				category: schema.workshop.category,
				markerColor: schema.workshop.markerColor,
				markerShape: schema.workshop.markerShape,
			})
			.from(schema.workshop)
			.where(eq(schema.workshop.eventId, found.id))
			.orderBy(asc(schema.workshop.sortOrder)),
		db
			.select({
				id: schema.eventSession.id,
				workshopId: schema.eventSession.workshopId,
				room: schema.location.name,
				startsAt: schema.eventSession.startsAt,
				endsAt: schema.eventSession.endsAt,
				capacity: schema.eventSession.capacity,
			})
			.from(schema.eventSession)
			.leftJoin(schema.location, eq(schema.location.id, schema.eventSession.locationId))
			.where(
				and(eq(schema.eventSession.eventId, found.id), eq(schema.eventSession.status, 'scheduled')),
			)
			.orderBy(asc(schema.eventSession.startsAt)),
	])

	const eligibility = await db
		.select({
			workshopId: schema.workshopAgeGroup.workshopId,
			label: schema.ageGroup.label,
		})
		.from(schema.workshopAgeGroup)
		.innerJoin(schema.ageGroup, eq(schema.ageGroup.id, schema.workshopAgeGroup.ageGroupId))
		.where(eq(schema.ageGroup.eventId, found.id))
		.orderBy(asc(schema.ageGroup.sortOrder))
	const ageGroupsOf = new Map<string, string[]>()
	for (const row of eligibility) {
		ageGroupsOf.set(row.workshopId, [...(ageGroupsOf.get(row.workshopId) ?? []), row.label])
	}

	const { organizationId: _, ...event } = found
	return {
		event,
		// Empty ageGroups means open to everyone.
		workshops: workshops.map((workshop) => ({
			...workshop,
			ageGroups: ageGroupsOf.get(workshop.id) ?? [],
		})),
		sessions,
		ageGroups: await db
			.select({ id: schema.ageGroup.id, label: schema.ageGroup.label })
			.from(schema.ageGroup)
			.where(eq(schema.ageGroup.eventId, found.id))
			.orderBy(asc(schema.ageGroup.sortOrder)),
	}
}

export type PublicEvent = NonNullable<Awaited<ReturnType<typeof getPublicEvent>>>

/**
 * Where an old public path now lives, after a slug rename (D19). Event renames
 * record the full old path; organization renames record just "/old-org", which
 * covers every event under it.
 */
export async function findRedirect(db: Db, path: string): Promise<string | null> {
	const lookup = async (oldPath: string) => {
		const [found] = await db
			.select({ organizationSlug: schema.organization.slug, eventSlug: schema.event.slug })
			.from(schema.slugRedirect)
			.innerJoin(
				schema.organization,
				eq(schema.organization.id, schema.slugRedirect.organizationId),
			)
			.leftJoin(schema.event, eq(schema.event.id, schema.slugRedirect.eventId))
			.where(eq(schema.slugRedirect.oldPath, oldPath))
			.limit(1)
		return found
	}

	const exact = await lookup(path)
	if (exact) {
		return exact.eventSlug
			? `/${exact.organizationSlug}/${exact.eventSlug}`
			: `/${exact.organizationSlug}`
	}

	const [, firstSegment, ...rest] = path.split('/')
	const renamedOrganization = firstSegment ? await lookup(`/${firstSegment}`) : undefined
	if (renamedOrganization && !renamedOrganization.eventSlug) {
		return [`/${renamedOrganization.organizationSlug}`, ...rest].join('/')
	}
	return null
}

/** What participant actions and emails need about a public event, by id. Null unless published or closed. */
export async function publicEventMeta(db: Db, eventId: string) {
	const [found] = await db
		.select({
			id: schema.event.id,
			organizationId: schema.event.organizationId,
			name: schema.event.name,
			slug: schema.event.slug,
			organizationSlug: schema.organization.slug,
			defaultLocale: schema.event.defaultLocale,
			timezone: schema.event.timezone,
			status: schema.event.status,
		})
		.from(schema.event)
		.innerJoin(schema.organization, eq(schema.organization.id, schema.event.organizationId))
		.where(and(eq(schema.event.id, eventId), inArray(schema.event.status, ['published', 'closed'])))
		.limit(1)
	return found ?? null
}
