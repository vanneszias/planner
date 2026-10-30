/**
 * Entry point for `pnpm generate-schema` only. The Better Auth CLI reads this
 * config to know which plugins need tables; it never connects to a database.
 */
import { createDb } from '@app/db'
import { createAuth } from './src/index.ts'

export const auth = createAuth({
	db: createDb({} as D1Database),
	baseURL: 'http://localhost:3000',
	secret: 'schema-generation-only',
	sendEmail: async () => {},
})
