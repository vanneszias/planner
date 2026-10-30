/** The domain's FileStorage on an R2 bucket (EU). R2 deletes at most 1,000 keys per call. */
export function r2Files(bucket: R2Bucket) {
	return {
		async putText(key: string, text: string, contentType: string): Promise<void> {
			await bucket.put(key, text, { httpMetadata: { contentType } })
		},
		async delete(keys: string[]): Promise<void> {
			for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000))
		},
	}
}
