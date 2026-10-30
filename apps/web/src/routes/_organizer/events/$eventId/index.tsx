import { Button } from '@app/ui/components/button'
import { createFileRoute, getRouteApi, Link, useRouter } from '@tanstack/react-router'
import { cn } from 'cn'
import { useState } from 'react'
import { FormError } from '#/components/auth-shell'
import { actionMessage } from '#/lib/errors'
import { m } from '#/paraglide/messages'
import { setEventStatusFn } from '#/server/events'

export const Route = createFileRoute('/_organizer/events/$eventId/')({ component: Overview })
const eventRoute = getRouteApi('/_organizer/events/$eventId')

/** Checklist that ticks itself off (journeys.md, O1 step 3). */
function Overview() {
	const { event, workshops, sessions, organizationSlug, canPublish } = eventRoute.useLoaderData()
	const router = useRouter()
	const [error, setError] = useState<string | null>(null)
	const [pending, setPending] = useState(false)
	const params = { eventId: event.id }
	const published = event.status === 'published'
	const publicPath = `/${organizationSlug}/${event.slug}`

	async function setStatus(status: 'published' | 'draft') {
		setError(null)
		setPending(true)
		const result = await setEventStatusFn({ data: { eventId: event.id, status } })
		setPending(false)
		if (!result.ok) return setError(actionMessage(result))
		await router.invalidate()
	}

	const steps = [
		{
			done: workshops.length > 0,
			label: m.checklist_workshops(),
			detail: m.workshop_count({ count: String(workshops.length) }),
			to: '/events/$eventId/workshops',
		},
		{
			done: sessions.length > 0,
			label: m.checklist_sessions(),
			detail: m.session_count({ count: String(sessions.length) }),
			to: '/events/$eventId/schedule',
		},
	] as const

	return (
		<div className="flex flex-col gap-6">
			<section aria-labelledby="checklist" className="rounded-xl bg-card p-5">
				<h2 id="checklist" className="mb-4 text-lg font-bold">
					{m.checklist_title()}
				</h2>
				<ol className="flex flex-col gap-2">
					{steps.map((item) => (
						<li key={item.label}>
							<Link
								to={item.to}
								params={params}
								className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-accent"
							>
								<CheckDot done={item.done} />
								<span className="flex-1 font-bold">{item.label}</span>
								<span className="text-sm text-muted-foreground">{item.detail}</span>
							</Link>
						</li>
					))}
					<li className="flex min-h-11 items-center gap-3 px-2">
						<CheckDot done={published} />
						<span className="flex-1 font-bold">{m.checklist_publish()}</span>
					</li>
				</ol>
			</section>

			<section className="flex flex-col gap-3 rounded-xl bg-card p-5" aria-live="polite">
				{published ? (
					<>
						<p className="font-bold">{m.published_notice()}</p>
						<p>
							{m.public_page_label()}:{' '}
							<a href={publicPath} className="font-mono text-primary underline underline-offset-4">
								{publicPath}
							</a>
						</p>
					</>
				) : (
					<p>{m.draft_notice()}</p>
				)}
				{canPublish && (
					<div>
						<Button
							variant={published ? 'outline' : 'default'}
							disabled={pending}
							onClick={() => setStatus(published ? 'draft' : 'published')}
						>
							{published ? m.unpublish_button() : m.publish_button()}
						</Button>
					</div>
				)}
				<FormError message={error} />
			</section>
		</div>
	)
}

/** Done state is shown by shape and fill, and announced as text. */
function CheckDot({ done }: { done: boolean }) {
	return (
		<span
			className={cn(
				'grid size-6 shrink-0 place-items-center rounded-full border-2 text-sm font-bold',
				done ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
			)}
		>
			<span aria-hidden="true">{done ? '✓' : ''}</span>
			<span className="sr-only">({done ? m.checklist_done() : m.checklist_todo()})</span>
		</span>
	)
}
