import { env } from 'cloudflare:workers'
import { createDb, type Db } from '@app/db'
import {
	DomainError,
	deleteResponse,
	findRespondent,
	listRespondents,
	organizerContext,
	type Poll,
	pollByShareCode,
	type Responder,
	type ResponseInput,
	resolvePoll,
	saveResponse,
} from '@app/domain'
import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { deleteCookie, getRequestHeaders } from '@tanstack/react-start/server'
import { getAuth } from './auth'
import { action } from './organizer'
import { notifyPoll, pollLink, sendPollOutcome } from './poll-notify'
import { cookieName, cookieRespondent, editLink, setRespondentCookie } from './poll-session'
import { clientIp, withinLimit } from './rate-limit'

/*
 * The public poll page (docs/availability-polls.md). Anyone with the link
 * may answer. Signed-in people answer as their account; guests get a signed
 * cookie and a private edit link, so they can change their answer later.
 */

/** Who is looking at the poll: their account, their guest cookie, or nobody yet. */
async function whoIsThis(db: Db, poll: Poll) {
	const session = await getAuth().api.getSession({ headers: getRequestHeaders() })
	if (session) {
		const responder: Responder = { kind: 'user', userId: session.user.id }
		return {
			session,
			responder,
			respondent: await findRespondent(db, poll.id, { userId: session.user.id }),
		}
	}
	const respondentId = await cookieRespondent(db, poll.id)
	const respondent = respondentId ? await findRespondent(db, poll.id, { respondentId }) : null
	const responder: Responder = respondent
		? { kind: 'respondent', respondentId: respondent.id }
		: { kind: 'guest' }
	return { session: null, responder, respondent }
}

async function loadPoll(db: Db, code: string): Promise<Poll> {
	const poll = await pollByShareCode(db, code)
	if (!poll) throw notFound()
	return poll
}

export const getPublicPoll = createServerFn({ method: 'GET' })
	.validator((code: string) => code)
	.handler(async ({ data: code }) => {
		const db = createDb(env.DB)
		let poll = await loadPoll(db, code)

		// The cron decides every 15 minutes; whoever opens the page first after the deadline needn't wait.
		if (await resolvePoll(db, poll)) {
			poll = await loadPoll(db, code)
			await sendPollOutcome(db, poll)
			await notifyPoll(poll.id)
		}

		const { session, respondent } = await whoIsThis(db, poll)
		const organizer = session
			? await organizerContext(db, session.user.id, poll.organizationId)
			: null
		const namesVisible = poll.showNames || Boolean(organizer)
		const respondents = (await listRespondents(db, poll.id)).map((r) => ({
			id: r.id,
			// Hidden names stay hidden, except your own.
			name: namesVisible || r.id === respondent?.id ? r.name : null,
			availability: r.availability,
		}))
		const mine = respondents.find((r) => r.id === respondent?.id)

		return {
			poll: {
				id: poll.id,
				shareCode: poll.shareCode,
				title: poll.title,
				description: poll.description,
				location: poll.location,
				timezone: poll.timezone,
				startsOn: poll.startsOn,
				endsOn: poll.endsOn,
				dayStartMinutes: poll.dayStartMinutes,
				dayEndMinutes: poll.dayEndMinutes,
				durationMinutes: poll.durationMinutes,
				status: poll.status,
				decisionMode: poll.decisionMode,
				deadlineAt: poll.deadlineAt?.getTime() ?? null,
				minAttendees: poll.minAttendees,
				showNames: poll.showNames,
				confirmedStartsAt: poll.confirmedStartsAt?.getTime() ?? null,
				confirmedEndsAt: poll.confirmedEndsAt?.getTime() ?? null,
			},
			link: pollLink(poll),
			respondents,
			me: respondent
				? {
						respondentId: respondent.id,
						name: respondent.name,
						// Signed-in people get mail at their account address.
						email: respondent.userId ? null : respondent.email,
						availability: mine?.availability ?? { free: [], ifNeeded: [] },
					}
				: null,
			viewer: session ? { signedIn: true, name: session.user.name } : { signedIn: false, name: '' },
			/** Set for the poll's organizers: a link to manage it. */
			manageId: organizer ? poll.id : null,
		}
	})

export const saveMyResponseFn = createServerFn({ method: 'POST' })
	.validator((input: { code: string } & ResponseInput) => input)
	.handler(async ({ data: { code, ...input } }) => {
		const db = createDb(env.DB)
		const poll = await loadPoll(db, code)
		return action(async () => {
			if (!(await withinLimit('ranking', `${clientIp()}:${poll.id}`))) {
				throw new DomainError('rate_limited', 'Too many requests')
			}
			const { responder } = await whoIsThis(db, poll)
			const saved = await saveResponse(db, poll, responder, {
				...input,
				email: responder.kind === 'user' ? null : (input.email ?? null),
			})
			if (saved.editToken) await setRespondentCookie(db, poll.id, saved.respondentId)
			await notifyPoll(poll.id)
			return { editLink: saved.editToken ? editLink(saved.editToken) : null }
		})
	})

export const deleteMyResponseFn = createServerFn({ method: 'POST' })
	.validator((code: string) => code)
	.handler(async ({ data: code }) => {
		const db = createDb(env.DB)
		const poll = await loadPoll(db, code)
		return action(async () => {
			const { respondent } = await whoIsThis(db, poll)
			if (!respondent) return
			await deleteResponse(db, poll, respondent.id)
			deleteCookie(cookieName(poll.id), { path: '/' })
			await notifyPoll(poll.id)
		})
	})
