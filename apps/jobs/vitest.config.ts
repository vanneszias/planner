import { coordinatorStubWorker } from '@app/config/vitest/coordinator-stub'
import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.jsonc' },
			miniflare: { workers: [coordinatorStubWorker] },
		}),
	],
})
