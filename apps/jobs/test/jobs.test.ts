import { env } from 'cloudflare:workers'
import { createDb, schema, uuidv7 } from '@app/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import worker from '../src/index.ts'

const db = createDb(env.DB)

/** An organization with an event that ended on `endsOn`, and one participant. */
async function seed(endsOn: string) {
	const organizationId = uuidv7()
	const eventId = uuidv7()
	await db.batch([
		db.insert(schema.organization).values({
			id: organizationId,
			name: 'Org',
			slug: `org-${organizationId}`,
			createdAt: new Date(),
		}),
		db.insert(schema.event).values({
			id: eventId,
			organizationId,
			slug: 'camp',
			name: 'Camp',
			timezone: 'Europe/Brussels',
			startsOn: endsOn,
			endsOn,
		}),
		db.insert(schema.registration).values({
			organizationId,
			eventId,
			registeredBy: 'self',
			displayName: '@SUM(A1)',
			email: 'ana@example.com',
			accessTokenHash: `a-${eventId}`,
			shortCodeHash: `c-${eventId}`,
		}),
	])
	return { organizationId, eventId }
}

function batchOf(body: unknown) {
	const message = { id: '1', attempts: 1, body, ack: vi.fn(), retry: vi.fn() }
	return { message, batch: { messages: [message] } as unknown as MessageBatch<never> }
}

describe('jobs', () => {
	it('builds an export into R2 from a queue message, once', async () => {
		const { organizationId, eventId } = await seed('2027-07-13')
		const [job] = await db
			.insert(schema.exportJob)
			.values({
				organizationId,
				eventId,
				kind: 'participants',
				expiresAt: new Date(Date.now() + 1e6),
			})
			.returning()
		const { message, batch } = batchOf({ kind: 'export', exportId: job?.id })
		await worker.queue(batch, env)
		expect(message.ack).toHaveBeenCalled()

		const [done] = await db
			.select()
			.from(schema.exportJob)
			.where(eq(schema.exportJob.id, job?.id as string))
		expect(done).toMatchObject({ status: 'ready', rows: 1 })
		const file = await env.FILES.get(done?.r2Key as string)
		const text = await file?.text()
		expect(text).toContain("'@SUM(A1)")
		expect(file?.httpMetadata?.contentType).toBe('text/csv; charset=utf-8')
	})

	it('anonymises events past retention and deletes expired exports on the cron', async () => {
		const old = await seed('2020-01-01')
		const recent = await seed('2099-01-01')
		await env.FILES.put('exports/x/old.csv', 'name')
		await db.insert(schema.exportJob).values({
			organizationId: old.organizationId,
			eventId: recent.eventId,
			kind: 'attendance',
			status: 'ready',
			r2Key: 'exports/x/old.csv',
			expiresAt: new Date('2021-01-01'),
		})

		await worker.scheduled({ scheduledTime: Date.now(), cron: '0 3 * * *', noRetry: () => {} }, env)

		const people = await db.select().from(schema.registration)
		const byEvent = (id: string) => people.find((p) => p.eventId === id)
		expect(byEvent(old.eventId)).toMatchObject({ displayName: '', email: null })
		expect(byEvent(recent.eventId)).toMatchObject({ email: 'ana@example.com' })
		expect(await env.FILES.get('exports/x/old.csv')).toBeNull()
	})
})
