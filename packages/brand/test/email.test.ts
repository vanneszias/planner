import { describe, expect, it } from 'vitest'
import { readableAccent, renderEmailHtml } from '../src/email.ts'
import { brand, colors } from '../src/index.ts'

const app = 'https://events.example'
const link = 'https://events.example/r/abc123'

describe('renderEmailHtml', () => {
	it('turns a URL paragraph into a button, with the URL beneath it', () => {
		const html = renderEmailHtml(
			{ to: 'a@example.com', subject: 'Hi', text: `Your link:\n\n${link}\n\n${brand.name}` },
			app,
		)
		expect(html).toContain(`<a href="${link}" style="display:inline-block`)
		expect(html).toContain('>Open link</a>')
		expect(html).toContain(`${app}/brand-mark.png`)
		// The text signature is dropped: the footer signs instead.
		expect(html.match(new RegExp(`>${brand.name}<`, 'g'))).toHaveLength(1)
	})

	it('links inline URLs without swallowing trailing punctuation', () => {
		const html = renderEmailHtml(
			{ to: 'a', subject: 's', text: `Not you? Cancel: ${link}?then=cancel.` },
			app,
		)
		expect(html).toContain(`<a href="${link}?then=cancel"`)
		expect(html).toContain('</a>.</p>')
	})

	it('escapes organizer-supplied text', () => {
		const html = renderEmailHtml(
			{
				to: 'a',
				subject: '<b>',
				text: 'Hello <script>alert(1)</script>',
				theme: { name: 'Camp "&" <Co>', accent: 'red;background:url(x)' },
			},
			app,
		)
		expect(html).not.toContain('<script>')
		expect(html).toContain('Camp &quot;&amp;&quot; &lt;Co&gt;')
		expect(html).not.toContain('url(x)')
	})

	it('uses the event name and accent, and Dutch chrome', () => {
		const html = renderEmailHtml(
			{
				to: 'a',
				subject: 's',
				text: link,
				locale: 'nl',
				theme: { name: 'Zomerkamp', accent: '#7A4FC9' },
			},
			app,
		)
		expect(html).toContain('Zomerkamp')
		expect(html).toContain('bgcolor="#7A4FC9"')
		expect(html).toContain('>Open de link</a>')
		expect(html).toContain('lang="nl"')
	})
})

describe('readableAccent', () => {
	it('falls back to the platform colour for missing or invalid values', () => {
		expect(readableAccent(null)).toBe(colors.kelp)
		expect(readableAccent('teal')).toBe(colors.kelp)
	})

	it('darkens light accents until white text reaches 4.5:1', () => {
		const darkened = readableAccent('#FFD400')
		expect(darkened).not.toBe('#FFD400')
		const n = Number.parseInt(darkened.slice(1), 16)
		const lum = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
			.map((c) => c / 255)
			.map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4))
		const l = 0.2126 * (lum[0] ?? 0) + 0.7152 * (lum[1] ?? 0) + 0.0722 * (lum[2] ?? 0)
		expect(1.05 / (l + 0.05)).toBeGreaterThanOrEqual(4.5)
	})

	it('keeps accents that already pass', () => {
		expect(readableAccent('#0e6b5c')).toBe('#0E6B5C')
	})
})
