/** Files the domain writes or removes outside D1: exports and run snapshots. R2 in production. */
export type FileStorage = {
	putText(key: string, text: string, contentType: string): Promise<void>
	delete(keys: string[]): Promise<void>
}
