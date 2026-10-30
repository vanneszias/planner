import { env, exports } from 'cloudflare:workers'
import { createDb, schema, uuidv7 } from '@app/db'
import { signExportLink } from '@app/domain'
import { describe, expect, it } from 'vitest'

const db = createDb(env.DB)

async function readyExport(expiresAt = new Date(Date.now() + 1e6)) {
	const organizationId = uuidv7()
	const eventId = uuidv7()
	const id = uuidv7()
	const r2Key = `exports/${organizationId}/${id}.csv`
	await db.batch([
		db.insert(schema.organization).values({
			id: organizationId,
			name: 'Org',
			slug: `o-${organizationId}`,
			createdAt: new Date(),
		}),
		db.insert(schema.event).values({
			id: eventId,
			organizationId,
			slug: 'camp',
			name: 'Camp',
			timezone: 'Europe/Brussels',
			startsOn: '2027-07-12',
			endsOn: '2027-07-12',
		}),
		db.insert(schema.exportJob).values({
			id,
			organizationId,
			eventId,
			kind: 'attendance',
			status: 'ready',
			r2Key,
			createdAt: new Date('2027-07-12T10:00:00Z'),
			expiresAt,
		}),
	])
	await env.FILES.put(r2Key, 'Name\nAna\n')
	return id
}

const link = async (id: string, key = 'test-key') => {
	const { expires, signature } = await signExportLink(key, id)
	return `https://api.test/exports/${id}?expires=${expires}&signature=${signature}`
}

describe('export downloads', () => {
	it('serves a ready export through a valid signed link', async () => {
		const id = await readyExport()
		const response = await exports.default.fetch(await link(id))
		expect(response.status).toBe(200)
		expect(response.headers.get('Content-Disposition')).toBe(
			'attachment; filename="camp-attendance-2027-07-12.csv"',
		)
		expect(response.headers.get('Cache-Control')).toBe('private, no-store')
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
		expect(await response.text()).toBe('Name\nAna\n')
	})

	it('refuses wrong signatures, other exports and expired files', async () => {
		const id = await readyExport()
		const other = await readyExport()
		expect((await exports.default.fetch(await link(id, 'wrong'))).status).toBe(404)
		expect((await exports.default.fetch((await link(id)).replace(id, other))).status).toBe(404)
		expect((await exports.default.fetch(`https://api.test/exports/${id}`)).status).toBe(404)
		const expired = await readyExport(new Date(Date.now() - 1000))
		expect((await exports.default.fetch(await link(expired))).status).toBe(404)
	})
})
