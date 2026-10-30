import {
	createServerEntry,
	createStartHandler,
	defaultStreamHandler,
} from '@tanstack/react-start/server'
import { paraglideMiddleware } from './paraglide/server.js'

// Same as TanStack Start's default entry, plus locale resolution (cookie, then
// Accept-Language) before rendering. Wired up as `main` in wrangler.jsonc.
const startFetch = createStartHandler(defaultStreamHandler)

export default createServerEntry({
	fetch: (request) => paraglideMiddleware(request, () => startFetch(request)),
})
