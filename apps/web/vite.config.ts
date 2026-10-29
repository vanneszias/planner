import { brand } from '@app/brand'
import { cloudflare } from '@cloudflare/vite-plugin'
import { paraglideVitePlugin } from '@inlang/paraglide-js'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(({ command }) => {
	// workerd doesn't implement Durable Object jurisdictions, so local dev runs
	// without one. Only for `vite dev`: builds keep "eu" from wrangler.jsonc.
	const local = command === 'serve' ? { vars: { COORDINATOR_JURISDICTION: '' } } : {}
	const localWeb =
		command === 'serve'
			? {
					vars: {
						COORDINATOR_JURISDICTION: '',
						BETTER_AUTH_URL: 'http://localhost:3000',
						EMAIL_DELIVERY: 'console',
					},
				}
			: {}

	return {
		resolve: { tsconfigPaths: true },
		plugins: [
			cloudflare({
				viteEnvironment: { name: 'ssr' },
				config: localWeb,
				// Run the other Workers in the same local session, so bindings between
				// them (the coordinator Durable Object, the jobs queue) work in dev.
				auxiliaryWorkers: [
					{ configPath: '../coordinator/wrangler.jsonc' },
					{ configPath: '../jobs/wrangler.jsonc', config: local },
					{ configPath: '../api/wrangler.jsonc', config: local },
				],
			}),
			paraglideVitePlugin({
				project: './project.inlang',
				outdir: './src/paraglide',
				emitTsDeclarations: true,
				cookieName: `${brand.slug}.locale`,
				// No locale in URLs: event links are shared across languages.
				strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
			}),
			tailwindcss(),
			tanstackStart(),
			viteReact(),
		],
	}
})
