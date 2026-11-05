import { cloudflare } from '@cloudflare/vite-plugin'
import { paraglideVitePlugin } from '@inlang/paraglide-js'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { paraglideOptions } from './paraglide.config'

export default defineConfig(({ command }) => {
	// workerd doesn't implement Durable Object jurisdictions, so local dev runs
	// without one. Only for `vite dev`: builds keep "eu" from wrangler.jsonc.
	const local = command === 'serve' ? { vars: { COORDINATOR_JURISDICTION: '' } } : {}
	// PORT lets a second checkout run beside another dev server.
	const origin = `http://localhost:${process.env.PORT ?? 3000}`
	const localWeb =
		command === 'serve'
			? {
					vars: {
						COORDINATOR_JURISDICTION: '',
						BETTER_AUTH_URL: origin,
						EMAIL_DELIVERY: 'console',
						TURNSTILE_SITE_KEY: '1x00000000000000000000BB',
						// `wrangler dev` in apps/api, sharing this app's local state (see Running it).
						API_URL: 'http://localhost:8787',
					},
				}
			: {}

	// scripts/preview.sh builds against one branch's own resources.
	const configFile = process.env.PREVIEW_CONFIG ? 'wrangler.preview.json' : 'wrangler.jsonc'

	return {
		resolve: { tsconfigPaths: true },
		plugins: [
			cloudflare({
				viteEnvironment: { name: 'ssr' },
				configPath: `./${configFile}`,
				config: localWeb,
				// Run the other Workers in the same local session, so bindings between
				// them (the coordinator Durable Object, the jobs queue) work in dev.
				auxiliaryWorkers: [
					{ configPath: `../coordinator/${configFile}` },
					{ configPath: `../jobs/${configFile}`, config: local },
					{ configPath: `../api/${configFile}`, config: local },
				],
			}),
			paraglideVitePlugin(paraglideOptions),
			tailwindcss(),
			tanstackStart(),
			viteReact(),
		],
	}
})
