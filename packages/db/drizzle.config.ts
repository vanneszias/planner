import { defineConfig } from 'drizzle-kit'

// Generates SQL only. Wrangler applies it: `wrangler d1 migrations apply`.
export default defineConfig({
	dialect: 'sqlite',
	schema: './src/schema/index.ts',
	out: './migrations',
	casing: 'snake_case',
})
