import { schema } from '@app/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
	addMinor,
	anonymisationDate,
	anonymiseEvent,
	anonymiseEventNow,
	bookSession,
	checkIn,
	checkInCounts,
	checkInRoster,
	contextFromCode,
	contextFromToken,
	createDraftRun,
	createEvent,
	createSessions,
	createWorkshop,
	credentialFromScan,
	eventsDueForAnonymisation,
	expireExports,
	exportForDownload,
	type FileStorage,
	issueCredentials,
	listAuditLog,
	listExports,
	listSessions,
	type ParticipantContext,
	type RunStorage,
	registerSelf,
	requestExport,
	runExport,
	runRetention,
	setEventStatus,
	setPreferencesFor,
	signExportLink,
	undoCheckIn,
	updateEvent,
	verifyExportLink,
} from '../src/index.ts'
import { addMember, db, seedOrganization, summerCamp } from './fixtures.ts'

/** R2 stand-in for exports, run snapshots and deletes. */
function memoryFiles() {
	const objects = new Map<string, string>()
	const files: FileStorage & RunStorage = {
		putText: async (key, text) => void objects.set(key, text),
		put: async (key, value) => void objects.set(key, JSON.stringify(value)),
		get: async (key) => (objects.has(key) ? JSON.parse(objects.get(key) as string) : null),
		delete: async (keys) => {
			for (const key of keys) objects.delete(key)
		},
	}
	return { files, objects }
}

/** A published booking event with two overlapping workshops and one later one. */
async function eventDay(eventFields: { mode?: 'booking' | 'ranking' } = {}) {
	const ctx = await seedOrganization()
	const event = await createEvent(db, ctx, { ...summerCamp, ...eventFields })
	for (const [title, start, end] of [
		['Climbing', '10:00', '11:00'],
		['Printing', '10:30', '11:30'],
		['Podcast', '13:00', '14:00'],
	] as const) {
		const workshop = await createWorkshop(db, ctx, event.id, { title })
		await createSessions(db, ctx, event.id, {
			workshopId: workshop.id,
			room: 'Hall',
			capacity: 5,
			slots: [{ date: '2027-07-12', start, end }],
		})
	}
	await setEventStatus(db, ctx, event.id, 'published')
	const sessions = await listSessions(db, ctx, event.id)
	const id = (title: string) => sessions.find((s) => s.workshopTitle === title)?.id as string
	return { ctx, event, climb: id('Climbing'), print: id('Printing'), podcast: id('Podcast') }
}

let n = 0
async function person(eventId: string, name = `Person ${n + 1}`) {
	n++
	const result = await registerSelf(db, eventId, { name, email: `p${n}-${eventId}@example.com` })
	if (result.kind !== 'created') throw new Error('expected a new registration')
	return { context: result.context as ParticipantContext, ...result.credentials }
}

describe('credentialFromScan', () => {
	it('reads private links, bare tokens and typed codes', () => {
		expect(credentialFromScan('https://x.dev/r/AbCdEfGhIjKlMnOpQrStUv')).toEqual({
			token: 'AbCdEfGhIjKlMnOpQrStUv',
		})
		expect(credentialFromScan('https://x.dev/r/AbCdEfGhIjKlMnOpQrStUv?then=cancel')).toEqual({
			token: 'AbCdEfGhIjKlMnOpQrStUv',
		})
		expect(credentialFromScan('AbCdEfGhIjKlMnOpQrStUv')).toEqual({
			token: 'AbCdEfGhIjKlMnOpQrStUv',
		})
		expect(credentialFromScan(' k7q2-xa ')).toEqual({ code: 'k7q2-xa' })
		expect(credentialFromScan('hello world')).toBeNull()
		expect(credentialFromScan('https://example.com/')).toBeNull()
	})
})

describe('check-in', () => {
	it('checks in by link, code or name, per session and for the event', async () => {
		const { ctx, event, climb } = await eventDay()
		const ana = await person(event.id, 'Ana')
		const ben = await person(event.id, 'Ben')
		await bookSession(db, ana.context, climb)
		await bookSession(db, ben.context, climb)

		const byLink = await checkIn(db, ctx, event.id, {
			sessionId: climb,
			credential: credentialFromScan(`https://x.dev/r/${ana.token}`) ?? { code: '' },
		})
		expect(byLink).toMatchObject({ ok: true, status: 'checked_in', person: { name: 'Ana' } })
		expect(
			await checkIn(db, ctx, event.id, { sessionId: climb, credential: { token: ana.token } }),
		).toMatchObject({ ok: true, status: 'already' })
		expect(
			await checkIn(db, ctx, event.id, {
				sessionId: climb,
				credential: { code: ben.code.toLowerCase() },
			}),
		).toMatchObject({ ok: true, status: 'checked_in', person: { name: 'Ben' } })
		expect(
			await checkIn(db, ctx, event.id, {
				sessionId: null,
				credential: { registrationId: ana.context.registrationId },
			}),
		).toMatchObject({ ok: true, status: 'checked_in' })

		expect(await checkInCounts(db, event.id)).toMatchObject({
			sessions: { [climb]: { booked: 2, here: 2 } },
			event: { registered: 2, here: 1 },
		})
		const roster = await checkInRoster(db, ctx, event.id, climb)
		expect(roster.map((r) => [r.name, r.checkedInAt !== null])).toEqual([
			['Ana', true],
			['Ben', true],
		])

		await undoCheckIn(db, ctx, event.id, climb, ben.context.registrationId)
		expect((await checkInCounts(db, event.id)).sessions[climb]).toEqual({ booked: 2, here: 1 })
	})

	it('says where someone is booked instead, and checks them in anyway on request', async () => {
		const { ctx, event, climb, print } = await eventDay()
		const ana = await person(event.id, 'Ana')
		await bookSession(db, ana.context, climb)
		expect(
			await checkIn(db, ctx, event.id, { sessionId: print, credential: { token: ana.token } }),
		).toMatchObject({ ok: false, reason: 'not_booked', bookedElsewhere: 'Climbing' })
		expect(
			await checkIn(db, ctx, event.id, {
				sessionId: print,
				credential: { token: ana.token },
				force: true,
			}),
		).toMatchObject({ ok: true, status: 'checked_in' })
		expect((await checkInCounts(db, event.id)).sessions[print]).toEqual({ booked: 1, here: 1 })
	})

	it("doesn't recognise links, codes or people from another event", async () => {
		const first = await eventDay()
		const second = await eventDay()
		const stranger = await person(second.event.id)
		for (const credential of [
			{ token: stranger.token },
			{ code: stranger.code },
			{ registrationId: stranger.context.registrationId },
			{ token: 'AAAAAAAAAAAAAAAAAAAAAA' },
		]) {
			expect(await checkIn(db, first.ctx, first.event.id, { sessionId: null, credential })).toEqual(
				{ ok: false, reason: 'unknown' },
			)
		}
		expect(
			await checkIn(db, first.ctx, first.event.id, {
				sessionId: second.climb,
				credential: { registrationId: (await person(first.event.id)).context.registrationId },
			}),
		).toEqual({ ok: false, reason: 'session_not_found' })
	})

	it('needs participant write access, and stays inside the organization', async () => {
		const { ctx, event, climb } = await eventDay()
		const ana = await person(event.id)
		const viewer = await addMember(ctx.organizationId, 'viewer')
		await expect(
			checkIn(db, viewer, event.id, { sessionId: climb, credential: { token: ana.token } }),
		).rejects.toMatchObject({ code: 'forbidden' })
		const other = await seedOrganization()
		await expect(
			checkIn(db, other, event.id, { sessionId: climb, credential: { token: ana.token } }),
		).rejects.toMatchObject({ code: 'not_found' })
		await expect(checkInRoster(db, other, event.id, null)).rejects.toMatchObject({
			code: 'not_found',
		})
	})
})

describe('exports', () => {
	it('builds participant, programme and attendance CSVs once, guarded against formulas', async () => {
		const { ctx, event, climb, podcast } = await eventDay()
		const { files, objects } = memoryFiles()
		const ana = await person(event.id, '=HYPERLINK("http://evil")')
		await bookSession(db, ana.context, climb)
		await bookSession(db, ana.context, podcast)
		await checkIn(db, ctx, event.id, { sessionId: climb, credential: { token: ana.token } })

		const csv: Record<string, string> = {}
		for (const kind of ['participants', 'programmes', 'attendance'] as const) {
			const job = await requestExport(db, ctx, event.id, kind)
			expect(await runExport(db, files, job.id)).toBe('built')
			expect(await runExport(db, files, job.id)).toBe('skipped')
			csv[kind] = objects.get(`exports/${ctx.organizationId}/${job.id}.csv`) ?? ''
		}
		// Dutch event: semicolons, Dutch headers, BOM first.
		expect(csv.participants?.startsWith('\uFEFFNaam;Leeftijdsgroep')).toBe(true)
		expect(csv.participants).toContain(`"'=HYPERLINK(""http://evil"")"`)
		expect(csv.participants).not.toMatch(/(^|;)=HYPERLINK/m)
		expect(csv.programmes?.split('\n').filter(Boolean)).toHaveLength(3)
		expect(csv.attendance).toContain('2027-07-12;10:00;11:00;Climbing;Hall;5;')
		expect(csv.attendance).toMatch(/Climbing;Hall;5;.*;\d{4}-\d\d-\d\d \d\d:\d\d\n/)

		const ready = await listExports(db, ctx, event.id)
		expect(ready.map((e) => e.status)).toEqual(['ready', 'ready', 'ready'])
		const download = await exportForDownload(db, ctx, ready[0]?.id as string)
		expect(download.r2Key).toMatch(/^exports\//)
	})

	it('keeps exports to people with export access in the same organization', async () => {
		const { ctx, event } = await eventDay()
		const job = await requestExport(db, ctx, event.id, 'participants')
		const viewer = await addMember(ctx.organizationId, 'viewer')
		await expect(requestExport(db, viewer, event.id, 'attendance')).resolves.toBeTruthy()
		const other = await seedOrganization()
		await expect(requestExport(db, other, event.id, 'participants')).rejects.toMatchObject({
			code: 'not_found',
		})
		const { files } = memoryFiles()
		await runExport(db, files, job.id)
		await expect(exportForDownload(db, other, job.id)).rejects.toMatchObject({
			code: 'not_found',
		})
	})

	it('deletes files once they expire', async () => {
		const { ctx, event } = await eventDay()
		const { files, objects } = memoryFiles()
		const job = await requestExport(db, ctx, event.id, 'participants', new Date('2027-07-01'))
		await runExport(db, files, job.id)
		expect(objects.size).toBe(1)
		expect(await expireExports(db, files, new Date('2027-07-09'))).toBeGreaterThanOrEqual(1)
		expect(objects.size).toBe(0)
		await expect(exportForDownload(db, ctx, job.id)).rejects.toMatchObject({ code: 'not_found' })
	})

	it('signs download links for 15 minutes', async () => {
		const now = Date.now()
		const { expires, signature } = await signExportLink('secret', 'job-1', now)
		expect(await verifyExportLink('secret', 'job-1', expires, signature, now)).toBe(true)
		expect(await verifyExportLink('secret', 'job-2', expires, signature, now)).toBe(false)
		expect(await verifyExportLink('other', 'job-1', expires, signature, now)).toBe(false)
		expect(await verifyExportLink('secret', 'job-1', expires, signature, expires + 1)).toBe(false)
		expect(await verifyExportLink('', 'job-1', expires, signature, now)).toBe(false)
	})
})

describe('retention', () => {
	it('dates anonymisation retention_days after the last day', () => {
		expect(anonymisationDate({ endsOn: '2027-07-13', retentionDays: 90 })).toBe('2027-10-11')
	})

	it('anonymises names, credentials, rankings and snapshots, and keeps attendance', async () => {
		const { ctx, event, climb } = await eventDay({ mode: 'ranking' })
		await updateEvent(db, ctx, event.id, { rankMinimum: 1 })
		const { files, objects } = memoryFiles()
		const ana = await person(event.id, 'Ana')
		const minor = await addMinor(db, ctx, event.id, {
			name: 'Noor',
			guardianEmail: 'parent@example.com',
		})
		const [card] = await issueCredentials(db, ctx, event.id, [minor as string])
		const workshops = await db
			.select({ id: schema.workshop.id })
			.from(schema.workshop)
			.where(eq(schema.workshop.eventId, event.id))
		await setPreferencesFor(db, ctx, event.id, ana.context.registrationId, [
			workshops[0]?.id as string,
		])
		await createDraftRun(db, files, ctx, event.id, { seed: 'fixed' })
		await db.insert(schema.assignment).values({
			organizationId: ctx.organizationId,
			eventId: event.id,
			registrationId: ana.context.registrationId,
			sessionId: climb,
			source: 'manual',
			checkedInAt: new Date(),
		})
		const job = await requestExport(db, ctx, event.id, 'participants')
		await runExport(db, files, job.id)
		expect(objects.size).toBe(3)

		// Not due before the date; due after it.
		const after = new Date(`${anonymisationDate(event)}T03:00:00Z`)
		expect(await eventsDueForAnonymisation(db, new Date('2027-08-01'))).not.toContain(event.id)
		expect(await eventsDueForAnonymisation(db, after)).toContain(event.id)
		const result = await runRetention(db, files, after)
		expect(result.done).toContain(event.id)

		const people = await db
			.select()
			.from(schema.registration)
			.where(eq(schema.registration.eventId, event.id))
		expect(people).toHaveLength(2)
		for (const p of people) {
			expect(p).toMatchObject({ displayName: '', email: null, guardianEmail: null, userId: null })
			expect(p.anonymisedAt).not.toBeNull()
		}
		expect(await contextFromToken(db, ana.token)).toBeNull()
		expect(await contextFromCode(db, event.id, card?.code as string)).toBeNull()
		expect(
			await db.select().from(schema.preference).where(eq(schema.preference.eventId, event.id)),
		).toEqual([])
		expect(objects.size).toBe(0)
		expect(await checkInCounts(db, event.id)).toMatchObject({
			sessions: { [climb]: { booked: 1, here: 1 } },
		})
		const [marked] = await db.select().from(schema.event).where(eq(schema.event.id, event.id))
		expect(marked?.dataDeletedAt).not.toBeNull()
		expect(await eventsDueForAnonymisation(db, after)).not.toContain(event.id)

		// Re-running is harmless.
		expect(await anonymiseEvent(db, files, event.id, null, after)).toEqual({
			registrations: 0,
			files: 0,
		})
		const log = await listAuditLog(db, ctx, { eventId: event.id, category: 'retention' })
		expect(log.entries).toHaveLength(1)
		expect(log.entries[0]).toMatchObject({ actorKind: 'system', actorName: null })
	})

	it('handles more people than one chunk', async () => {
		const { ctx, event } = await eventDay()
		const { files } = memoryFiles()
		const rows = Array.from({ length: 620 }, (_, i) => ({
			organizationId: ctx.organizationId,
			eventId: event.id,
			registeredBy: 'organizer' as const,
			displayName: `Bulk ${i}`,
			accessTokenHash: `bulk-a-${event.id}-${i}`,
			shortCodeHash: `bulk-c-${event.id}-${i}`,
		}))
		for (let i = 0; i < rows.length; i += 10) {
			await db.insert(schema.registration).values(rows.slice(i, i + 10))
		}
		expect(await anonymiseEventNow(db, files, ctx, event.id)).toMatchObject({
			registrations: 620,
		})
	})

	it('lets only editors and owners anonymise early, in their own organization', async () => {
		const { ctx, event } = await eventDay()
		const { files } = memoryFiles()
		const viewer = await addMember(ctx.organizationId, 'viewer')
		await expect(anonymiseEventNow(db, files, viewer, event.id)).rejects.toMatchObject({
			code: 'forbidden',
		})
		const other = await seedOrganization()
		await expect(anonymiseEventNow(db, files, other, event.id)).rejects.toMatchObject({
			code: 'not_found',
		})
	})
})

describe('audit log', () => {
	it('shows owners their organization only, filtered and paged', async () => {
		const { ctx, event } = await eventDay()
		for (let i = 0; i < 3; i++) await checkInRoster(db, ctx, event.id, null)
		const page = await listAuditLog(db, ctx, { category: 'checkin' })
		expect(page.entries).toHaveLength(3)
		expect(page.entries[0]).toMatchObject({
			action: 'checkin.roster',
			actorName: 'Test',
			eventName: summerCamp.name,
		})
		expect((await listAuditLog(db, ctx, { actorUserId: 'nobody' })).entries).toEqual([])

		const all = await listAuditLog(db, ctx)
		expect(all.entries.length).toBeGreaterThan(5)
		const ids = all.entries.map((e) => e.id)
		expect([...ids].sort().reverse()).toEqual(ids)

		const editor = await addMember(ctx.organizationId, 'editor')
		await expect(listAuditLog(db, editor)).rejects.toMatchObject({ code: 'forbidden' })
		const other = await seedOrganization()
		expect((await listAuditLog(db, other)).entries).toEqual([])
	})

	it('pages 50 at a time', async () => {
		const { ctx, event } = await eventDay()
		for (let i = 0; i < 55; i++) await checkInRoster(db, ctx, event.id, null)
		const first = await listAuditLog(db, ctx, { category: 'checkin' })
		expect(first.entries).toHaveLength(50)
		expect(first.next).not.toBeNull()
		const second = await listAuditLog(db, ctx, {
			category: 'checkin',
			before: first.next as string,
		})
		expect(second.entries).toHaveLength(5)
		expect(second.next).toBeNull()
	})
})
