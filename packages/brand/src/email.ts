import { brand, brandAssets, colors } from './index.ts'

/*
 * Branded HTML for every outgoing email. Templates stay plain text (the
 * text part, and the single source of the wording); this turns that text
 * into the HTML part at delivery time, so no template can skip the branding.
 *
 * - Paragraphs are separated by a blank line.
 * - A paragraph that is only a URL becomes a button, with the URL beneath it.
 * - Other URLs become links.
 * - A last paragraph that is just the platform name (the text signature) is
 *   dropped: the footer signs instead.
 */

export type EmailLocale = 'en' | 'nl'

/** An event's branding (design-system.md, "Event branding"). */
export type EmailTheme = {
	/** Shown in the header instead of the platform name. */
	name: string
	/** Event accent colour, `#rrggbb`. Darkened until white text on it reaches 4.5:1. */
	accent?: string | null
}

export type Email = {
	to: string
	subject: string
	text: string
	/** Language of the HTML chrome (button label, footer). Defaults to English. */
	locale?: EmailLocale
	/** Event emails carry the event's branding; everything else uses the platform's. */
	theme?: EmailTheme
}

const copy = {
	en: { button: 'Open link', fallback: 'Or paste this link in your browser:', sentBy: 'Sent with' },
	nl: {
		button: 'Open de link',
		fallback: 'Of plak deze link in je browser:',
		sentBy: 'Verstuurd met',
	},
} as const

const font =
	"-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif"
const mono = "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace"

const urlPattern = /https?:\/\/[^\s<>"]+/g

export function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;')
}

/** Trailing punctuation belongs to the sentence, not the URL. */
function splitUrl(match: string): [url: string, rest: string] {
	const url = match.replace(/[.,;:!?)]+$/, '')
	return [url, match.slice(url.length)]
}

function linkify(text: string, accent: string): string {
	let out = ''
	let last = 0
	for (const found of text.matchAll(urlPattern)) {
		const [url, rest] = splitUrl(found[0])
		out += escapeHtml(text.slice(last, found.index))
		out += `<a href="${escapeHtml(url)}" style="color:${accent};text-decoration:underline;word-break:break-all">${escapeHtml(url)}</a>${escapeHtml(rest)}`
		last = (found.index ?? 0) + found[0].length
	}
	return out + escapeHtml(text.slice(last))
}

function hexToRgb(hex: string): [number, number, number] {
	const n = Number.parseInt(hex.slice(1), 16)
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminance([r, g, b]: [number, number, number]): number {
	const channel = (c: number) => {
		const s = c / 255
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
	}
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/**
 * A safe button colour from an organizer's accent: anything that isn't
 * `#rrggbb` falls back to the platform colour, and light accents are darkened
 * until white text on them reaches 4.5:1 (design-system.md).
 */
export function readableAccent(accent: string | null | undefined): string {
	if (!accent || !/^#[0-9a-f]{6}$/i.test(accent)) return colors.kelp
	let rgb = hexToRgb(accent)
	while (1.05 / (luminance(rgb) + 0.05) < 4.5) {
		rgb = rgb.map((c) => Math.floor(c * 0.9)) as [number, number, number]
	}
	return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

function button(url: string, label: string, accent: string, fallback: string): string {
	const href = escapeHtml(url)
	return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px"><tr><td bgcolor="${accent}" style="border-radius:8px;background:${accent}"><a href="${href}" style="display:inline-block;padding:12px 22px;font-family:${font};font-size:16px;font-weight:600;line-height:20px;color:#FFFFFF;text-decoration:none;border-radius:8px">${escapeHtml(label)}</a></td></tr></table><p style="margin:0 0 20px;font-family:${font};font-size:13px;line-height:18px;color:${colors.muted}">${escapeHtml(fallback)}<br><a href="${href}" style="font-family:${mono};color:${colors.muted};word-break:break-all">${href}</a></p>`
}

function paragraph(text: string, accent: string): string {
	const html = text
		.split('\n')
		.map((line) => linkify(line, accent))
		.join('<br>')
	return `<p style="margin:0 0 20px;font-family:${font};font-size:16px;line-height:24px;color:${colors.ink}">${html}</p>`
}

/** The HTML part for an email. `appUrl` is the web app's origin, for the logo image. */
export function renderEmailHtml(email: Email, appUrl: string): string {
	const locale = email.locale ?? 'en'
	const t = copy[locale]
	const accent = readableAccent(email.theme?.accent)
	const blocks = email.text
		.replaceAll('\r\n', '\n')
		.split(/\n{2,}/)
		.map((block) => block.trim())
		.filter(Boolean)
	if (blocks.at(-1) === brand.name) blocks.pop()

	const body = blocks
		.map((block) =>
			/^https?:\/\/\S+$/.test(block)
				? button(block, t.button, accent, t.fallback)
				: paragraph(block, accent),
		)
		.join('')

	const logo = `<img src="${escapeHtml(appUrl)}${brandAssets.emailMark}" width="28" height="28" alt="" style="display:block;border:0;width:28px;height:28px">`
	const smallLogo = `<img src="${escapeHtml(appUrl)}${brandAssets.emailMark}" width="16" height="16" alt="" style="display:inline-block;border:0;width:16px;height:16px;vertical-align:-3px">`
	const heading = email.theme
		? `<td style="font-family:${font};font-size:18px;font-weight:700;line-height:24px;color:${colors.ink}">${escapeHtml(email.theme.name)}</td>`
		: `<td width="38" style="padding-right:10px">${logo}</td><td style="font-family:${font};font-size:18px;font-weight:700;line-height:24px;color:${colors.ink}">${escapeHtml(brand.name)}</td>`
	// A hidden preview line for inbox lists: the first sentence, not the header.
	const preheader = escapeHtml((blocks[0] ?? '').replace(urlPattern, '').slice(0, 140))

	return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(email.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${colors.paper}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${colors.paper}" style="background:${colors.paper}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td bgcolor="${colors.card}" style="background:${colors.card};border:1px solid ${colors.line};border-radius:12px;overflow:hidden">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td height="6" bgcolor="${accent}" style="height:6px;line-height:6px;font-size:0;background:${accent}">&nbsp;</td></tr>
<tr><td style="padding:24px 32px 8px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${heading}</tr></table></td></tr>
<tr><td style="padding:16px 32px 8px">${body}</td></tr>
</table>
</td></tr>
<tr><td align="center" style="padding:20px 16px 0;font-family:${font};font-size:13px;line-height:18px;color:${colors.muted}">${smallLogo}&nbsp; ${escapeHtml(t.sentBy)} ${escapeHtml(brand.name)} · ${escapeHtml(brand.description[locale])}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}
