import { exports } from 'cloudflare:workers'
import { expect, it } from 'vitest'

it('reports health', async () => {
	const response = await exports.default.fetch('https://api.test/health')
	expect(response.status).toBe(200)
	expect(await response.json()).toEqual({ ok: true })
})

it('returns 404 for unknown paths', async () => {
	const response = await exports.default.fetch('https://api.test/nope')
	expect(response.status).toBe(404)
})
