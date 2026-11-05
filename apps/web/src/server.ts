import {
	createServerEntry,
	createStartHandler,
	defaultStreamHandler,
} from '@tanstack/react-start/server'
import { paraglideMiddleware } from './paraglide/server.js'
import { newNonce, nonceHeader, secureResponse } from './server/csp'

export { EventCoordinator } from './server/stray-coordinator'

// Same as TanStack Start's default entry, plus locale resolution (cookie, then
// Accept-Language) before rendering, and security headers with a CSP nonce
// on every response. Wired up as `main` in wrangler.jsonc.
const startFetch = createStartHandler(defaultStreamHandler)

export default createServerEntry({
	fetch: async (incoming) => {
		// Vite's dev server injects inline scripts without a nonce: no CSP there.
		if (import.meta.env.DEV) return paraglideMiddleware(incoming, () => startFetch(incoming))
		const nonce = newNonce()
		// The router reads the nonce from this header (src/router.tsx); never trust a client's.
		const headers = new Headers(incoming.headers)
		headers.set(nonceHeader, nonce)
		const request = new Request(incoming, { headers })
		const response = await paraglideMiddleware(request, () => startFetch(request))
		return secureResponse(response, nonce, new URL(request.url).origin)
	},
})
