#!/usr/bin/env node
/*
 * Writes wrangler.preview.json next to each app's wrangler.jsonc, pointing the
 * Worker at one pull request's own resources (docs/previews.md).
 *
 *   node scripts/preview-config.mjs <pr-number> <d1-database-id>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [pr, databaseId] = process.argv.slice(2)
if (!/^\d+$/.test(pr ?? '') || !databaseId) {
	console.error('usage: node scripts/preview-config.mjs <pr-number> <d1-database-id>')
	process.exit(1)
}

const suffix = `-pr-${pr}`
const subdomain = process.env.WORKERS_SUBDOMAIN ?? 'zias'
const origin = (worker) => `https://${worker}${suffix}.${subdomain}.workers.dev`

const apps = ['coordinator', 'jobs', 'api', 'web']

/** Strips // and /* comments and trailing commas, leaving strings alone. */
function parseJsonc(text) {
	let out = ''
	for (let i = 0; i < text.length; i++) {
		const char = text[i]
		if (char === '"') {
			const start = i
			for (i++; text[i] !== '"'; i++) if (text[i] === '\\') i++
			out += text.slice(start, i + 1)
		} else if (char === '/' && text[i + 1] === '/') {
			while (i < text.length && text[i] !== '\n') i++
			out += '\n'
		} else if (char === '/' && text[i + 1] === '*') {
			i = text.indexOf('*/', i + 2) + 1
		} else out += char
	}
	return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

for (const app of apps) {
	const dir = join(import.meta.dirname, '..', 'apps', app)
	const config = parseJsonc(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8'))

	config.name += suffix
	// One preview version per deploy is enough; the Worker itself is the preview.
	config.preview_urls = false

	for (const db of config.d1_databases ?? []) {
		db.database_name = `event-db${suffix}`
		db.database_id = databaseId
	}
	// Shared by all previews: object keys are random ids, so they never collide.
	for (const bucket of config.r2_buckets ?? []) bucket.bucket_name = 'event-files-preview'
	for (const producer of config.queues?.producers ?? []) producer.queue = `event-jobs${suffix}`
	for (const consumer of config.queues?.consumers ?? []) {
		consumer.queue = `event-jobs${suffix}`
		delete consumer.dead_letter_queue
	}
	for (const binding of config.durable_objects?.bindings ?? []) {
		if (binding.script_name) binding.script_name += suffix
	}
	// No crons: the account's cron trigger limit is shared with production.
	if (config.triggers) config.triggers = { crons: [] }

	const vars = config.vars ?? {}
	if ('BETTER_AUTH_URL' in vars) vars.BETTER_AUTH_URL = origin('event-web')
	if ('APP_URL' in vars) vars.APP_URL = origin('event-web')
	if ('API_URL' in vars) vars.API_URL = origin('event-api')
	// Emails go to the Worker's logs instead of the (not yet working) queue.
	if ('EMAIL_DELIVERY' in vars) vars.EMAIL_DELIVERY = 'console'
	// Cloudflare's always-pass test key; the matching test secret is set on deploy.
	if ('TURNSTILE_SITE_KEY' in vars) vars.TURNSTILE_SITE_KEY = '1x00000000000000000000AA'

	writeFileSync(join(dir, 'wrangler.preview.json'), `${JSON.stringify(config, null, '\t')}\n`)
}

console.log(`Preview configs written for ${apps.map((a) => `event-${a}${suffix}`).join(', ')}`)
