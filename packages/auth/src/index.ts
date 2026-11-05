import { brand } from '@app/brand'
import type { Db } from '@app/db'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { captcha, haveIBeenPwned, magicLink, organization } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { ac, roles } from './permissions.ts'

/** An email the auth flows need sent. Delivery is the caller's concern (queue, console in dev). */
export type AuthEmail = { to: string; subject: string; text: string }

export type AuthOptions = {
	db: Db
	/** Public origin of the web app, e.g. https://events.zias.be */
	baseURL: string
	secret: string
	sendEmail: (email: AuthEmail) => Promise<void>
	/** Google sign-in is only enabled when both values are set (implementation-plan.md). */
	google?: { clientId?: string; clientSecret?: string }
	/** Runs after a user is created, e.g. to give them a personal organization. */
	onUserCreated?: (user: { id: string; name: string; email: string }) => Promise<void>
	/** Slugs organizations may not use (app routes). Checked on create and rename. */
	isReservedSlug?: (slug: string) => boolean
	/**
	 * Turnstile secret: when set, sign-up and magic link requests need a token in
	 * `x-captcha-response` (security-privacy.md, "Turnstile placement").
	 */
	turnstileSecret?: string
}

export function createAuth({
	db,
	baseURL,
	secret,
	sendEmail,
	google,
	onUserCreated,
	isReservedSlug = () => false,
	turnstileSecret,
}: AuthOptions) {
	const checkSlug = async ({ organization }: { organization: { slug?: string } }) => {
		if (organization.slug && isReservedSlug(organization.slug)) {
			throw new APIError('BAD_REQUEST', { message: 'SLUG_RESERVED' })
		}
	}

	const googleEnabled = Boolean(google?.clientId && google?.clientSecret)

	return betterAuth({
		appName: brand.name,
		baseURL,
		secret,
		database: drizzleAdapter(db, { provider: 'sqlite' }),
		advanced: { cookiePrefix: brand.slug },
		databaseHooks: {
			user: {
				create: {
					after: async (user) => {
						await onUserCreated?.({ id: user.id, name: user.name, email: user.email })
					},
				},
			},
		},
		// Workers isolates don't share memory, so in-memory counters would be useless.
		// Per IP and path; the rate limit table in security-privacy.md.
		rateLimit: {
			enabled: true,
			storage: 'database',
			customRules: {
				'/sign-in/magic-link': { window: 60, max: 10 },
				'/sign-in/email': { window: 60, max: 5 },
				'/sign-up/email': { window: 60, max: 5 },
				'/request-password-reset': { window: 60, max: 3 },
			},
		},
		session: {
			// Organizer sessions expire after 30 days idle (security-privacy.md).
			expiresIn: 60 * 60 * 24 * 30,
			updateAge: 60 * 60 * 24,
			freshAge: 60 * 60 * 12,
		},
		emailAndPassword: {
			enabled: true,
			minPasswordLength: 10,
			sendResetPassword: ({ user, url }) =>
				sendEmail({
					to: user.email,
					subject: `Reset your ${brand.name} password`,
					text: `Use this link to choose a new password:\n\n${url}\n\nIf you didn't ask for this, you can ignore this email.`,
				}),
		},
		emailVerification: {
			// Password sign-ups confirm their address: passes attach only to verified emails (D29).
			sendOnSignUp: true,
			sendVerificationEmail: ({ user, url }) =>
				sendEmail({
					to: user.email,
					subject: `Confirm your email for ${brand.name}`,
					text: `Confirm your email address with this link:\n\n${url}`,
				}),
		},
		socialProviders: googleEnabled
			? {
					google: {
						clientId: google?.clientId as string,
						clientSecret: google?.clientSecret as string,
					},
				}
			: {},
		plugins: [
			magicLink({
				expiresIn: 60 * 15,
				sendMagicLink: ({ email, url }) =>
					sendEmail({
						to: email,
						subject: `Sign in to ${brand.name}`,
						text: `Use this link to sign in. It works once and expires in 15 minutes.\n\n${url}`,
					}),
			}),
			passkey({ rpID: new URL(baseURL).hostname, rpName: brand.name, origin: baseURL }),
			organization({
				ac,
				roles,
				creatorRole: 'owner',
				organizationHooks: {
					beforeCreateOrganization: checkSlug,
					beforeUpdateOrganization: checkSlug,
				},
				sendInvitationEmail: ({ email, organization, inviter, id }) =>
					sendEmail({
						to: email,
						subject: `${inviter.user.name} invited you to ${organization.name}`,
						text: `Accept the invitation here:\n\n${baseURL}/invitations/${id}`,
					}),
			}),
			haveIBeenPwned(),
			...(turnstileSecret
				? [
						captcha({
							provider: 'cloudflare-turnstile',
							secretKey: turnstileSecret,
							endpoints: ['/sign-up/email', '/sign-in/magic-link'],
						}),
					]
				: []),
			// Must stay last (Better Auth TanStack Start docs).
			tanstackStartCookies(),
		],
	})
}

export type Auth = ReturnType<typeof createAuth>
