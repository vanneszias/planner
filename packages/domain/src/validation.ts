import type { z } from 'zod'
import { invalid } from './errors.ts'

/**
 * Parses input or throws a DomainError with one issue code per field
 * (`required`, `too_long`, …). The UI translates codes; the domain stays
 * language-free.
 */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
	const result = schema.safeParse(input)
	if (result.success) return result.data
	const issues: Record<string, string> = {}
	for (const issue of result.error.issues) {
		const field = issue.path.join('.') || '_'
		issues[field] ??= issue.message
	}
	throw invalid(issues)
}
