/*
 * Poll emails, in the poll's language. They carry the shared poll link and
 * nothing about anyone else's availability (security-privacy.md, "Email").
 * `web` sends them directly; the `jobs` Worker sends them after an automatic
 * decision.
 */

type Locale = 'en' | 'nl'
/** Same shape as Email in @app/brand/email; the jobs Worker renders the branded HTML. */
export type PollEmail = { to: string; subject: string; text: string; locale: Locale }

const signature = (appName: string) => `\n\n${appName}`

/** "Tuesday 12 November, 19:30–21:30" in the poll's timezone and language. */
export function formatPollWindow(
	startsAt: number,
	endsAt: number,
	timeZone: string,
	locale: Locale,
): string {
	const lang = locale === 'nl' ? 'nl-BE' : 'en-GB'
	const day = new Intl.DateTimeFormat(lang, {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		timeZone,
	}).format(startsAt)
	const time = new Intl.DateTimeFormat(lang, {
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
		timeZone,
	})
	return `${day}, ${time.format(startsAt)}–${time.format(endsAt)}`
}

export function pollInviteEmail(input: {
	to: string
	locale: Locale
	appName: string
	organizerName: string
	title: string
	link: string
	deadline: string | null
}): PollEmail {
	const { locale, appName, organizerName, title, link, deadline } = input
	if (locale === 'nl') {
		return {
			to: input.to,
			locale,
			subject: `Wanneer kun je? ${title}`,
			text: `${organizerName} zoekt een moment voor ${title}. Duid aan wanneer je kunt:\n\n${link}${deadline ? `\n\nGraag voor ${deadline}.` : ''}${signature(appName)}`,
		}
	}
	return {
		to: input.to,
		locale,
		subject: `When can you make it? ${title}`,
		text: `${organizerName} is finding a time for ${title}. Mark when you're free:\n\n${link}${deadline ? `\n\nPlease answer before ${deadline}.` : ''}${signature(appName)}`,
	}
}

export function pollConfirmedEmail(input: {
	to: string
	locale: Locale
	appName: string
	title: string
	when: string
	location: string
	link: string
}): PollEmail {
	const { locale, appName, title, when, location, link } = input
	if (locale === 'nl') {
		return {
			to: input.to,
			locale,
			subject: `${title}: ${when}`,
			text: `Het moment voor ${title} staat vast:\n\n${when}${location ? `\n${location}` : ''}\n\nZet het in je agenda via ${link}${signature(appName)}`,
		}
	}
	return {
		to: input.to,
		locale,
		subject: `${title}: ${when}`,
		text: `The time for ${title} is set:\n\n${when}${location ? `\n${location}` : ''}\n\nAdd it to your calendar from ${link}${signature(appName)}`,
	}
}

export function pollNeedsDecisionEmail(input: {
	to: string
	locale: Locale
	appName: string
	title: string
	link: string
}): PollEmail {
	const { locale, appName, title, link } = input
	if (locale === 'nl') {
		return {
			to: input.to,
			locale,
			subject: `Kies zelf een moment: ${title}`,
			text: `De deadline voor ${title} is voorbij, maar geen enkel moment haalde het minimum. Kies zelf een moment of open de peiling opnieuw:\n\n${link}${signature(appName)}`,
		}
	}
	return {
		to: input.to,
		locale,
		subject: `Pick a time: ${title}`,
		text: `The deadline for ${title} has passed, but no time reached the minimum. Pick one yourself or reopen the poll:\n\n${link}${signature(appName)}`,
	}
}
