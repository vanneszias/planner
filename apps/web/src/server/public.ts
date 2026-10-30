import { env } from 'cloudflare:workers'
import { createDb } from '@app/db'
import { findRedirect, getPublicEvent } from '@app/domain'
import { notFound, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

/** The public event page. No session needed; only published events. */
export const getPublicEventFn = createServerFn({ method: 'GET' })
	.validator((input: { org: string; event: string }) => input)
	.handler(async ({ data }) => {
		const db = createDb(env.DB)
		const page = await getPublicEvent(db, data.org, data.event)
		if (page) return page
		const moved = await findRedirect(db, `/${data.org}/${data.event}`)
		if (moved) throw redirect({ href: moved, statusCode: 301 })
		throw notFound()
	})
