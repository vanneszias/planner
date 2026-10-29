/**
 * Platform branding. "Planner" is a working name: this is the only place a
 * product name may appear. Everything user-facing (titles, metadata, emails,
 * PWA manifest, cookie names) reads from here.
 *
 * Event branding (an organizer's logo and accent colour) is separate and lives
 * on the event record.
 */
export const brand = {
	name: 'Planner',
	/** Lowercase, no spaces. Used for cookie names and storage keys, not for URLs or schemas. */
	slug: 'planner',
	description: {
		en: 'One event. Your own experience.',
		nl: 'Eén evenement. Jouw eigen programma.',
	},
	/** Default platform colour (docs/design-system.md, "kelp"). */
	themeColor: '#0E6B5C',
	email: {
		fromName: 'Planner',
	},
} as const

export type Brand = typeof brand
