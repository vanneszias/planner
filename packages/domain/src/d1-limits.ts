/*
 * D1 limits that shape queries (https://developers.cloudflare.com/d1/platform/limits/):
 * at most 100 bound parameters per statement, and 1,000 queries per Worker
 * invocation, where a whole db.batch() counts as one query.
 */

/** Values per `IN (...)` list, leaving room for the query's other parameters. */
export const maxInList = 90

/** Rows per multi-row insert, given how many values each row binds. */
export const rowsPerInsert = (valuesPerRow: number) => Math.max(1, Math.floor(90 / valuesPerRow))

export function chunk<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = []
	for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
	return chunks
}
