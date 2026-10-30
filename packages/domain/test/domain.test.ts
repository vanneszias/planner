import { schema } from '@app/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
	createEvent,
	createSessions,
	createWorkshop,
	findRedirect,
	getEvent,
	getPublicEvent,
	listSessions,
	markerFor,
	renameEventSlug,
	roomConflicts,
	sessionSlot,
	setEventStatus,
	slugify,
	updateEvent,
	updateOrganization,
	utcToZoned,
	zonedToUtc,
} from '../src/index.ts'
import { addMember, db, seedOrganization, summerCamp } from './fixtures.ts'

describe('permissions', () => {
	it('lets editors build events and stops viewers', async () => {
		const owner = await seedOrganization('owner')
		const editor = await addMember(owner.organizationId, 'editor')
		const viewer = await addMember(owner.organizationId, 'viewer')

		const event = await createEvent(db, editor, summerCamp)
		await expect(createWorkshop(db, editor, event.id, { title: 'Theatre' })).resolves.toBeTruthy()

		await expect(createEvent(db, viewer, summerCamp)).rejects.toMatchObject({ code: 'forbidden' })
		await expect(createWorkshop(db, viewer, event.id, { title: 'Nope' })).rejects.toMatchObject({
			code: 'forbidden',
		})
		await expect(updateEvent(db, viewer, event.id, { name: 'Nope' })).rejects.toMatchObject({
			code: 'forbidden',
		})
		// Viewers can still read.
		await expect(getEvent(db, viewer, event.id)).resolves.toMatchObject({ id: event.id })
	})
})

describe('events', () => {
	it('gives each event in an organization its own slug', async () => {
		const ctx = await seedOrganization()
		const first = await createEvent(db, ctx, summerCamp)
		const second = await createEvent(db, ctx, summerCamp)
		expect(first.slug).toBe('zomerkamp-2027')
		expect(second.slug).toBe('zomerkamp-2027-2')
	})

	it('reports field problems as codes', async () => {
		const ctx = await seedOrganization()
		await expect(
			createEvent(db, ctx, {
				...summerCamp,
				name: ' ',
				endsOn: '2027-07-01',
				timezone: 'Mars/Base',
			}),
		).rejects.toMatchObject({
			code: 'invalid',
			issues: { name: 'required', timezone: 'timezone' },
		})
		await expect(
			createEvent(db, ctx, { ...summerCamp, endsOn: '2027-07-01' }),
		).rejects.toMatchObject({ issues: { endsOn: 'date_order' } })
	})

	it('checks date order against stored dates on partial updates', async () => {
		const ctx = await seedOrganization()
		const event = await createEvent(db, ctx, summerCamp)
		await expect(updateEvent(db, ctx, event.id, { endsOn: '2027-07-01' })).rejects.toMatchObject({
			issues: { endsOn: 'date_order' },
		})
	})

	it('stores the booking window in UTC and keeps it in order', async () => {
		const ctx = await seedOrganization()
		const event = await createEvent(db, ctx, summerCamp)
		const updated = await updateEvent(db, ctx, event.id, {
			opens: { date: '2027-05-03', time: '10:00' },
			closes: { date: '2027-06-30', time: '23:59' },
		})
		expect(updated.opensAt?.toISOString()).toBe('2027-05-03T08:00:00.000Z')
		await expect(
			updateEvent(db, ctx, event.id, { closes: { date: '2027-05-01', time: '09:00' } }),
		).rejects.toMatchObject({ issues: { closes: 'time_order' } })
		const cleared = await updateEvent(db, ctx, event.id, { opens: null, closes: null })
		expect(cleared.opensAt).toBeNull()
	})

	it('keeps the minimum number of ranked workshops within the limit', async () => {
		const ctx = await seedOrganization()
		const event = await createEvent(db, ctx, summerCamp)
		await expect(
			updateEvent(db, ctx, event.id, { rankLimit: 4, rankMinimum: 5 }),
		).rejects.toMatchObject({ issues: { rankMinimum: 'too_large' } })
	})

	it('cascades deletes from the organization (D1 enforces foreign keys)', async () => {
		const ctx = await seedOrganization()
		const event = await createEvent(db, ctx, summerCamp)
		await db.delete(schema.organization).where(eq(schema.organization.id, ctx.organizationId))
		const rows = await db.select().from(schema.event).where(eq(schema.event.id, event.id))
		expect(rows).toEqual([])
	})
})

describe('sessions', () => {
	it('stores times in UTC from the event timezone and reuses rooms by name', async () => {
		const ctx = await seedOrganization()
		const event = await createEvent(db, ctx, summerCamp)
		const workshop = await createWorkshop(db, ctx, event.id, { title: 'Climbing' })
		await createSessions(db, ctx, event.id, {
			workshopId: workshop.id,
			room: 'Hall B',
			capacity: 12,
			slots: [
				{ date: '2027-07-12', start: '10:00', end: '11:15' },
				{ date: '2027-07-13', start: '13:30', end: '15:00' },
			],
		})
		await createSessions(db, ctx, event.id, {
			workshopId: workshop.id,
			room: 'hall b',
			capacity: 12,
			slots: [{ date: '2027-07-12', start: '11:00', end: '12:00' }],
		})

		const sessions = await listSessions(db, ctx, event.id)
		expect(sessions).toHaveLength(3)
		// Brussels is UTC+2 in July.
		expect(sessions[0]?.startsAt.toISOString()).toBe('2027-07-12T08:00:00.000Z')
		expect(sessionSlot(sessions[0] as (typeof sessions)[0], event.timezone)).toEqual({
			date: '2027-07-12',
			start: '10:00',
			end: '11:15',
		})
		expect(new Set(sessions.map((s) => s.locationId)).size).toBe(1)
		// 10:00–11:15 and 11:00–12:00 in the same room overlap.
		expect(roomConflicts(sessions)).toHaveLength(1)
	})

	it('rejects sessions outside the event dates or ending before they start', async () => {
		const ctx = await seedOrganization()
		const event = await createEvent(db, ctx, summerCamp)
		const workshop = await createWorkshop(db, ctx, event.id, { title: 'Climbing' })
		const attempt = (slot: { date: string; start: string; end: string }) =>
			createSessions(db, ctx, event.id, { workshopId: workshop.id, capacity: 5, slots: [slot] })

		await expect(
			attempt({ date: '2027-07-20', start: '10:00', end: '11:00' }),
		).rejects.toMatchObject({
			issues: { 'slots.0.date': 'outside_event' },
		})
		await expect(
			attempt({ date: '2027-07-12', start: '11:00', end: '10:00' }),
		).rejects.toMatchObject({
			issues: { 'slots.0.end': 'time_order' },
		})
	})
})

describe('public event page', () => {
	it('shows published events only, without internal fields', async () => {
		const ctx = await seedOrganization('owner', 'scouts-gent-test')
		const event = await createEvent(db, ctx, summerCamp)
		const workshop = await createWorkshop(db, ctx, event.id, { title: 'Screen printing' })
		await createSessions(db, ctx, event.id, {
			workshopId: workshop.id,
			capacity: 8,
			slots: [{ date: '2027-07-12', start: '10:00', end: '11:15' }],
		})

		expect(await getPublicEvent(db, 'scouts-gent-test', event.slug)).toBeNull()

		await setEventStatus(db, ctx, event.id, 'published')
		const page = await getPublicEvent(db, 'scouts-gent-test', event.slug)
		expect(page?.event.name).toBe(summerCamp.name)
		expect(page?.event).not.toHaveProperty('organizationId')
		expect(page?.workshops.map((w) => w.title)).toEqual(['Screen printing'])
		expect(page?.sessions).toHaveLength(1)

		expect(await getPublicEvent(db, 'some-other-org', event.slug)).toBeNull()
	})
})

describe('helpers', () => {
	it('slugifies Dutch and accented names', () => {
		expect(slugify('Zomerkamp 2027 – Gent')).toBe('zomerkamp-2027-gent')
		expect(slugify('Été à Liège!')).toBe('ete-a-liege')
	})

	it('converts across daylight saving changes', () => {
		// Brussels: UTC+1 in winter, UTC+2 in summer; clocks change 2027-03-28 and 2027-10-31.
		expect(zonedToUtc('2027-01-15', '09:00', 'Europe/Brussels').toISOString()).toBe(
			'2027-01-15T08:00:00.000Z',
		)
		expect(zonedToUtc('2027-03-28', '12:00', 'Europe/Brussels').toISOString()).toBe(
			'2027-03-28T10:00:00.000Z',
		)
		expect(zonedToUtc('2027-10-31', '12:00', 'Europe/Brussels').toISOString()).toBe(
			'2027-10-31T11:00:00.000Z',
		)
		expect(utcToZoned(new Date('2027-07-12T08:00:00Z'), 'Europe/Brussels')).toEqual({
			date: '2027-07-12',
			time: '10:00',
		})
	})

	it('gives 64 workshops distinct markers', () => {
		const pairs = new Set(
			Array.from({ length: 64 }, (_, n) => {
				const marker = markerFor(n)
				return `${marker.markerColor}/${marker.markerShape}`
			}),
		)
		expect(pairs.size).toBe(64)
	})
})

describe('renames keep old links working (D19)', () => {
	it('redirects an old event path after an event slug change', async () => {
		const ctx = await seedOrganization('owner', `org-rename-${Date.now()}`)
		const event = await createEvent(db, ctx, summerCamp)
		await setEventStatus(db, ctx, event.id, 'published')
		const renamed = await renameEventSlug(db, ctx, event.id, 'Zomerkamp Gent')
		expect(renamed).toBe('zomerkamp-gent')
		expect(await findRedirect(db, `/${ctx.slug}/${event.slug}`)).toBe(`/${ctx.slug}/zomerkamp-gent`)
		expect(await getPublicEvent(db, ctx.slug, 'zomerkamp-gent')).not.toBeNull()
	})

	it('redirects every event path after an organization slug change', async () => {
		const ctx = await seedOrganization('owner', `old-org-${Date.now()}`)
		const event = await createEvent(db, ctx, summerCamp)
		const newSlug = `new-org-${Date.now()}`
		await updateOrganization(db, ctx, { name: 'Scouts Gent', slug: newSlug })
		expect(await findRedirect(db, `/${ctx.slug}/${event.slug}`)).toBe(`/${newSlug}/${event.slug}`)
	})

	it('refuses reserved and taken slugs, and non-owners', async () => {
		const ctx = await seedOrganization('owner')
		const other = await seedOrganization('owner')
		await expect(updateOrganization(db, ctx, { name: 'X', slug: 'api' })).rejects.toMatchObject({
			issues: { slug: 'reserved' },
		})
		await expect(
			updateOrganization(db, ctx, { name: 'X', slug: other.slug }),
		).rejects.toMatchObject({
			issues: { slug: 'taken' },
		})
		const editor = await addMember(ctx.organizationId, 'editor')
		await expect(
			updateOrganization(db, editor, { name: 'X', slug: 'fine-slug' }),
		).rejects.toMatchObject({
			code: 'forbidden',
		})

		const first = await createEvent(db, ctx, summerCamp)
		const second = await createEvent(db, ctx, { ...summerCamp, name: 'Other' })
		await expect(renameEventSlug(db, ctx, second.id, first.slug)).rejects.toMatchObject({
			issues: { slug: 'taken' },
		})
	})
})
