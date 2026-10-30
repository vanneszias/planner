/**
 * Allocation run snapshots in R2 (EU bucket). Matches the domain's RunStorage
 * shape; kept here so the domain package has no Cloudflare imports.
 */
export function r2RunStorage(bucket: R2Bucket) {
	return {
		async put(key: string, value: unknown): Promise<void> {
			await bucket.put(key, JSON.stringify(value), {
				httpMetadata: { contentType: 'application/json' },
			})
		},
		async get<T>(key: string): Promise<T | null> {
			const object = await bucket.get(key)
			return object ? ((await object.json()) as T) : null
		},
	}
}
