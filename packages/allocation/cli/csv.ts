/** Minimal RFC 4180 CSV: quoted fields, doubled quotes, commas or semicolons. */
export function parseCsv(text: string): Record<string, string>[] {
	// Drop a byte-order mark (Excel adds one to UTF-8 exports).
	const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
	const firstLine = clean.slice(0, clean.indexOf('\n') === -1 ? undefined : clean.indexOf('\n'))
	// Spreadsheets set to Dutch or French export with semicolons.
	const separator =
		(firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','

	const rows: string[][] = []
	let row: string[] = []
	let field = ''
	let quoted = false
	for (let i = 0; i < clean.length; i++) {
		const ch = clean[i]
		if (quoted) {
			if (ch === '"' && clean[i + 1] === '"') {
				field += '"'
				i++
			} else if (ch === '"') {
				quoted = false
			} else {
				field += ch
			}
		} else if (ch === '"') {
			quoted = true
		} else if (ch === separator) {
			row.push(field)
			field = ''
		} else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && clean[i + 1] === '\n') i++
			row.push(field)
			rows.push(row)
			row = []
			field = ''
		} else {
			field += ch
		}
	}
	if (field !== '' || row.length > 0) {
		row.push(field)
		rows.push(row)
	}

	const [header, ...body] = rows.filter((r) => r.some((cell) => cell.trim() !== ''))
	if (!header) return []
	const keys = header.map((h) => h.trim().toLowerCase())
	return body.map((cells) => Object.fromEntries(keys.map((k, i) => [k, (cells[i] ?? '').trim()])))
}

/**
 * Quotes a value for CSV output. Cells a spreadsheet would read as a formula
 * (=, +, -, @, or a leading tab or carriage return) get a leading '
 * (security-privacy.md, OWASP "CSV injection").
 */
export function csvCell(value: string | number | null | undefined): string {
	let text = value == null ? '' : String(value)
	if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
	return /[",;\n\r\t]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Comma-separated by default; Dutch and French spreadsheets expect semicolons. */
export function toCsv(rows: (string | number | null | undefined)[][], separator = ','): string {
	return `${rows.map((r) => r.map(csvCell).join(separator)).join('\n')}\n`
}
