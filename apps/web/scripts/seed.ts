/**
 * Local demo data: the M1 exit-criterion event (20 workshops, 60 sessions,
 * 10 rooms, 2 days), owned by an existing local account.
 *
 *   pnpm --filter @app/web seed organizer@example.com
 *
 * Writes to the local D1 database only (Wrangler's platform proxy).
 */
import { createDb, schema } from '@app/db'
import {
	createEvent,
	createSessions,
	createWorkshop,
	organizerContext,
	saveAgeGroups,
	setEventStatus,
} from '@app/domain'
import { eq } from 'drizzle-orm'
import { getPlatformProxy } from 'wrangler'

const email = process.argv[2]
if (!email) {
	console.error('Usage: pnpm --filter @app/web seed <email of a local account>')
	process.exit(1)
}

const titles = [
	'Screen printing',
	'Climbing',
	'Podcast lab',
	'Theatre sport',
	'Bike repair',
	'Forest cooking',
	'Street dance',
	'Comic drawing',
	'Beatboxing',
	'First aid',
	'Stop-motion film',
	'Board game design',
	'Bushcraft',
	'Upcycling',
	'Slackline',
	'Photo walk',
	'Songwriting',
	'Coding robots',
	'Juggling',
	'Campfire songs',
]
const rooms = [
	'Atelier',
	'Hall A',
	'Hall B',
	'Studio 1',
	'Studio 2',
	'Meadow',
	'Forest',
	'Kitchen',
	'Garage',
	'Attic',
]
const slots = [
	{ date: '2027-07-12', start: '10:00', end: '11:15' },
	{ date: '2027-07-12', start: '13:30', end: '14:45' },
	{ date: '2027-07-13', start: '10:00', end: '11:15' },
]

const { env, dispose } = await getPlatformProxy<{ DB: D1Database }>({
	configPath: 'wrangler.jsonc',
})
try {
	const db = createDb(env.DB)
	const [user] = await db.select().from(schema.user).where(eq(schema.user.email, email)).limit(1)
	if (!user) throw new Error(`No local account for ${email}. Sign up first.`)
	const [membership] = await db
		.select()
		.from(schema.member)
		.where(eq(schema.member.userId, user.id))
		.limit(1)
	if (!membership) throw new Error(`${email} has no organization.`)
	const ctx = await organizerContext(db, user.id, membership.organizationId)
	if (!ctx) throw new Error('Could not resolve the organizer context.')

	const started = performance.now()
	const event = await createEvent(db, ctx, {
		name: 'Zomerkamp 2027 (demo)',
		startsOn: '2027-07-12',
		endsOn: '2027-07-13',
		timezone: 'Europe/Brussels',
		mode: 'ranking',
		defaultLocale: 'nl',
		sessionsPerParticipant: 3,
	})
	const [young, older] = await saveAgeGroups(db, ctx, event.id, [
		{ label: '12–14' },
		{ label: '15–18' },
	])
	for (const [index, title] of titles.entries()) {
		const ageGroupIds =
			index % 5 === 0 ? [older?.id as string] : index % 7 === 0 ? [young?.id as string] : []
		const workshop = await createWorkshop(db, ctx, event.id, { title, ageGroupIds })
		// Each workshop runs three times; rooms rotate so no two overlap.
		await createSessions(db, ctx, event.id, {
			workshopId: workshop.id,
			room: rooms[index % rooms.length],
			capacity: 12 + (index % 4) * 4,
			// The second ten start 90 minutes later, so each room hosts two per block.
			slots: slots.map((slot) =>
				index < 10 ? slot : { ...slot, start: shift(slot.start, 90), end: shift(slot.end, 90) },
			),
		})
	}
	await setEventStatus(db, ctx, event.id, 'published')
	console.log(
		`Seeded "${event.name}" (${titles.length} workshops, ${titles.length * slots.length} sessions) in ${Math.round(performance.now() - started)} ms`,
	)
	console.log(`Organizer: /events/${event.id}`)
} finally {
	await dispose()
}

function shift(time: string, minutes: number): string {
	const [h, m] = time.split(':').map(Number)
	const total = (h as number) * 60 + (m as number) + minutes
	return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
