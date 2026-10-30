export type DomainErrorCode = 'not_found' | 'forbidden' | 'invalid' | 'conflict'

/**
 * Errors the UI can act on. `not_found` is also used when a record exists in
 * another organization: never reveal that it exists.
 */
export class DomainError extends Error {
	readonly code: DomainErrorCode
	/** Field-level problems for forms, keyed by field name. */
	readonly issues?: Record<string, string>

	constructor(code: DomainErrorCode, message: string, issues?: Record<string, string>) {
		super(message)
		this.name = 'DomainError'
		this.code = code
		this.issues = issues
	}
}

export const notFound = (what: string) => new DomainError('not_found', `${what} not found`)
export const forbidden = () => new DomainError('forbidden', 'Not allowed for your role')
export const invalid = (issues: Record<string, string>) =>
	new DomainError('invalid', 'Invalid input', issues)
