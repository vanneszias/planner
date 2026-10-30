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

/** A minor's private link, sent to their guardian (D24). */
export function guardianLinkEmail(input: {
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
			subject: `De link van ${name} voor ${eventName}`,
			text: `Hallo,\n\n${name} is ingeschreven voor ${eventName}. Met deze link kiezen jullie workshops en zien jullie het programma:\n\n${link}\n\nOf typ de code ${code} op de evenementpagina.\n\nOudere links en codes voor ${name} werken niet meer.\n\n${brand.name}`,
		}
	}
	return {
		to: input.to,
		subject: `${name}'s link for ${eventName}`,
		text: `Hello,\n\n${name} is registered for ${eventName}. This link lets you choose workshops and see the programme:\n\n${link}\n\nOr type the code ${code} on the event page.\n\nOlder links and codes for ${name} no longer work.\n\n${brand.name}`,
	}
}

/** After an allocation is published (O6 step 5). */
export function programmeReadyEmail(input: {
	to: string
	locale: Locale
	name: string
	eventName: string
	eventUrl: string
	changed: boolean
}): OutgoingEmail {
	const { locale, name, eventName, eventUrl, changed } = input
	if (locale === 'nl') {
		return {
			to: input.to,
			subject: changed
				? `Je programma voor ${eventName} is gewijzigd`
				: `Je programma voor ${eventName} is klaar`,
			text: `Hallo ${name},\n\n${changed ? 'Je programma is gewijzigd.' : 'Je programma staat klaar.'} Open het met de link uit je eerste mail, of op de evenementpagina met je code:\n\n${eventUrl}\n\n${brand.name}`,
		}
	}
	return {
		to: input.to,
		subject: changed
			? `Your programme for ${eventName} has changed`
			: `Your programme for ${eventName} is ready`,
		text: `Hi ${name},\n\n${changed ? 'Your programme has changed.' : 'Your programme is ready.'} Open it with the link from your first email, or on the event page with your code:\n\n${eventUrl}\n\n${brand.name}`,
	}
}
