/*
 * Generates the platform's static brand files from src/index.ts: favicons,
 * app icons, the PWA manifest, the share (Open Graph) card and the email
 * logo. Writes them to apps/web/public, plus assets/icon.svg for the README.
 * Rerun after changing the brand and commit the output:
 *
 *   pnpm --filter @app/brand assets
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { Resvg } from '@resvg/resvg-js'
import { brand, brandAssets, colors, markShapes, markSvg } from '../src/index.ts'

const root = join(import.meta.dirname, '..', '..', '..')
const out = join(root, 'apps', 'web', 'public')
const require = createRequire(import.meta.url)

/** WOFF 1 to a plain TrueType/OpenType font, which resvg can load (fontsource ships WOFF, not TTF). */
function woffToSfnt(woff: Buffer): Buffer {
	const numTables = woff.readUInt16BE(12)
	const tables = Array.from({ length: numTables }, (_, i) => {
		const entry = 44 + i * 20
		const offset = woff.readUInt32BE(entry + 4)
		const compLength = woff.readUInt32BE(entry + 8)
		const origLength = woff.readUInt32BE(entry + 12)
		const raw = woff.subarray(offset, offset + compLength)
		return {
			tag: woff.subarray(entry, entry + 4),
			checksum: woff.readUInt32BE(entry + 16),
			data: compLength < origLength ? inflateSync(raw) : raw,
		}
	})
	const header = Buffer.alloc(12 + 16 * numTables)
	woff.copy(header, 0, 4, 8) // sfnt version
	const pow = 2 ** Math.floor(Math.log2(numTables))
	header.writeUInt16BE(numTables, 4)
	header.writeUInt16BE(pow * 16, 6)
	header.writeUInt16BE(Math.log2(pow), 8)
	header.writeUInt16BE(numTables * 16 - pow * 16, 10)
	const chunks: Buffer[] = [header]
	let offset = header.length
	tables.forEach((table, i) => {
		const entry = 12 + i * 16
		table.tag.copy(header, entry)
		header.writeUInt32BE(table.checksum, entry + 4)
		header.writeUInt32BE(offset, entry + 8)
		header.writeUInt32BE(table.data.length, entry + 12)
		const padded = Buffer.alloc(Math.ceil(table.data.length / 4) * 4)
		table.data.copy(padded)
		chunks.push(padded)
		offset += padded.length
	})
	return Buffer.concat(chunks)
}

// resvg's Node binding only loads fonts from files, so convert into a temp dir.
const fontDir = mkdtempSync(join(tmpdir(), 'brand-fonts-'))
const fontFiles = [
	'@fontsource/unbounded/files/unbounded-latin-700-normal.woff',
	'@fontsource/inter/files/inter-latin-500-normal.woff',
].map((file, i) => {
	const path = join(fontDir, `${i}.ttf`)
	writeFileSync(path, woffToSfnt(readFileSync(require.resolve(file))))
	return path
})

function png(svg: string, width: number): Buffer {
	return Buffer.from(
		new Resvg(svg, {
			fitTo: { mode: 'width', value: width },
			font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Inter Medium' },
		})
			.render()
			.asPng(),
	)
}

/** The mark on a rounded paper tile, `inset` of the tile's width on each side. */
const tile = (inset: number, radius: number) => {
	const size = 28 / (1 - 2 * inset)
	const shift = (size - 28) / 2
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><title>${brand.name}</title><rect width="${size}" height="${size}" rx="${size * radius}" fill="${colors.paper}"/><g transform="translate(${shift} ${shift})">${markShapes}</g></svg>`
}

/** A favicon.ico holding one PNG (supported by every browser that still asks for .ico). */
function ico(image: Buffer, size: number): Buffer {
	const header = Buffer.alloc(22)
	header.writeUInt16BE(0, 0)
	header.writeUInt16LE(1, 2) // icon
	header.writeUInt16LE(1, 4) // one image
	header.writeUInt8(size, 6)
	header.writeUInt8(size, 7)
	header.writeUInt16LE(1, 10) // colour planes
	header.writeUInt16LE(32, 12) // bits per pixel
	header.writeUInt32LE(image.length, 14)
	header.writeUInt32LE(22, 18)
	return Buffer.concat([header, image])
}

const markers: [string, string][] = [
	[colors.marker.tomato, '<circle cx="10" cy="10" r="8"/>'],
	[colors.marker.sun, '<polygon points="10,2 18.5,17 1.5,17"/>'],
	[colors.marker.grass, '<rect x="3" y="3" width="14" height="14" rx="1.5"/>'],
	[colors.marker.sea, '<polygon points="10,1.5 18.5,10 10,18.5 1.5,10"/>'],
	[
		colors.marker.grape,
		'<polygon points="10,1.5 12.6,7.3 18.8,7.6 14,11.6 15.6,17.8 10,14.4 4.4,17.8 6,11.6 1.2,7.6 7.4,7.3"/>',
	],
	[
		colors.marker.bubblegum,
		'<polygon points="10,1.5 17.4,5.75 17.4,14.25 10,18.5 2.6,14.25 2.6,5.75"/>',
	],
	[colors.marker.sky, '<path d="M7.5 2.5h5v5h5v5h-5v5h-5v-5h-5v-5h5z"/>'],
	[colors.marker.moss, '<path d="M1.5 5h17a8.5 11.5 0 0 1-17 0z"/>'],
]

/**
 * The share card: a printed programme that happens to be live
 * (design-system.md). Brand band on top, the mark and name, the tagline, and
 * a perforated strip of workshop stickers along the bottom.
 */
const og = (() => {
	const stickers = markers
		.map(
			([fill, shape], i) =>
				`<g transform="translate(${96 + i * 132} 486) scale(3.6)" fill="${fill}" stroke="${colors.ink}" stroke-width="1.5" stroke-linejoin="round">${shape}</g>`,
		)
		.join('')
	return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="${colors.paper}"/>
<rect width="1200" height="16" fill="${colors.kelp}"/>
<g transform="translate(96 104) scale(5)">${markShapes}</g>
<text x="270" y="210" font-family="Unbounded" font-weight="700" font-size="104" fill="${colors.ink}">${brand.name}</text>
<text x="100" y="340" font-family="Inter Medium" font-size="46" fill="${colors.muted}">${brand.description.en}</text>
<line x1="0" y1="440" x2="1200" y2="440" stroke="${colors.line}" stroke-width="3" stroke-dasharray="12 10"/>
${stickers}
</svg>`
})()

const manifest = {
	name: brand.name,
	short_name: brand.name,
	description: brand.description.en,
	start_url: '/',
	scope: '/',
	display: 'standalone',
	background_color: colors.paper,
	theme_color: brand.themeColor,
	icons: [
		{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
		{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
		{ src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
	],
}

const files: Record<string, string | Buffer> = {
	[brandAssets.favicon]: `${markSvg}\n`,
	[brandAssets.faviconIco]: ico(png(markSvg, 32), 32),
	[brandAssets.appleTouchIcon]: png(tile(0.14, 0), 180),
	'/icon-192.png': png(tile(0.12, 0.22), 192),
	'/icon-512.png': png(tile(0.12, 0.22), 512),
	// Maskable icons get cropped to a circle: keep the mark inside the 80% safe zone.
	'/icon-maskable-512.png': png(tile(0.22, 0), 512),
	[brandAssets.manifest]: `${JSON.stringify(manifest, null, '\t')}\n`,
	[brandAssets.ogImage]: png(og, 1200),
	[brandAssets.emailMark]: png(markSvg, 96),
}

for (const [path, content] of Object.entries(files)) {
	writeFileSync(join(out, path), content)
	console.log(`wrote apps/web/public${path}`)
}
writeFileSync(
	join(root, 'assets', 'icon.svg'),
	`${tile(0.12, 0.22).replace('<svg ', '<svg width="64" height="64" ')}\n`,
)
console.log('wrote assets/icon.svg')
rmSync(fontDir, { recursive: true })
