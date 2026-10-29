import { passkeyClient } from '@better-auth/passkey/client'
import { magicLinkClient, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { ac, roles } from './permissions.ts'

/** Browser-side auth client. Same origin as the app, so no baseURL needed. */
export const authClient = createAuthClient({
	plugins: [magicLinkClient(), passkeyClient(), organizationClient({ ac, roles })],
})
