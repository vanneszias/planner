import { brand } from '@app/brand'
import type { OutgoingEmail } from './email'

/*
 * Participant emails, in the event's language. They carry the recipient's own
 * private link and nothing about anyone else (security-privacy.md, "Email").
 */

type Locale = 'en' | 'nl'

export function registrationEmail(input: {
	to: string
	locale: Locale
	name: string
	eventName: string
	link: string
	code: string
}): OutgoingEmail {
	const { locale, name, eventName, link, code } = input
	if (locale === 'nl') {
		return {
			to: input.to,
			subject: `Je inschrijving voor ${eventName}`,
			text: `Hallo ${name},\n\nJe bent ingeschreven voor ${eventName}. Met deze link open je altijd je programma:\n\n${link}\n\nJe code is ${code}. Die kun je ook op de evenementpagina invullen.\n\nNiet jij? Schrap deze inschrijving: ${link}?then=cancel\n\n${brand.name}`,
		}
	}
	return {
		to: input.to,
		subject: `Your registration for ${eventName}`,
		text: `Hi ${name},\n\nYou're registered for ${eventName}. This link always opens your programme:\n\n${link}\n\nYour code is ${code}. You can also type it on the event page.\n\nNot you? Cancel this registration: ${link}?then=cancel\n\n${brand.name}`,
	}
}

export function newLinkEmail(input: {
	to: string
	locale: Locale
	eventName: string
	link: string
}): OutgoingEmail {
	const { locale, eventName, link } = input
	if (locale === 'nl') {
		return {
			to: input.to,
			subject: `Je link voor ${eventName}`,
			text: `Hier is een nieuwe link naar je programma voor ${eventName}:\n\n${link}\n\nOudere links werken niet meer.\n\n${brand.name}`,
		}
	}
	return {
		to: input.to,
		subject: `Your link for ${eventName}`,
		text: `Here's a new link to your programme for ${eventName}:\n\n${link}\n\nOlder links no longer work.\n\n${brand.name}`,
	}
}

export function promotedEmail(input: {
	to: string
	locale: Locale
	eventName: string
	workshop: string
	when: string
	eventUrl: string
}): OutgoingEmail {
	const { locale, eventName, workshop, when, eventUrl } = input
	if (locale === 'nl') {
		return {
			to: input.to,
			subject: `Je hebt een plaats: ${workshop}`,
			text: `Er kwam een plaats vrij. Je staat nu ingeschreven voor ${workshop} (${when}) op ${eventName}.\n\nJe programma: ${eventUrl}\n\n${brand.name}`,
		}
	}
	return {
		to: input.to,
		subject: `You got a place: ${workshop}`,
		text: `A place opened up. You're now booked for ${workshop} (${when}) at ${eventName}.\n\nYour programme: ${eventUrl}\n\n${brand.name}`,
	}
}
