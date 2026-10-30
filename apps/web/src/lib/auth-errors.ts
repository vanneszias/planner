import { m } from '#/paraglide/messages'

/** Turns a Better Auth error into a message that says what happened and what to do. */
export function authErrorMessage(error: { code?: string; status?: number } | null | undefined) {
	if (error?.status === 429) return m.error_rate_limited()
	switch (error?.code) {
		case 'INVALID_EMAIL_OR_PASSWORD':
			return m.error_invalid_credentials()
		case 'PASSWORD_COMPROMISED':
			return m.error_password_compromised()
		case 'PASSWORD_TOO_SHORT':
			return m.error_password_too_short()
		case 'USER_ALREADY_EXISTS':
		case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
			return m.error_user_exists()
		// Turnstile (the captcha plugin) didn't pass or the token was missing.
		case 'VERIFICATION_FAILED':
		case 'MISSING_RESPONSE':
			return m.refusal_bot()
		default:
			return m.error_generic()
	}
}
