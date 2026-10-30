import path from 'node:path'
import { coordinatorStubWorker } from '@app/config/vitest/coordinator-stub'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
	const migrations = await readD1Migrations(
		path.join(import.meta.dirname, '../../packages/db/migrations'),
	)
	return {
		plugins: [
			cloudflareTest({
				wrangler: { configPath: './wrangler.jsonc' },
				miniflare: {
					workers: [coordinatorStubWorker],
					bindings: { TEST_MIGRATIONS: migrations },
				},
			}),
		],
		test: { setupFiles: ['./test/setup.ts'] },
	}
})
