import { Button } from '@app/ui/components/button'
import { createFileRoute, Link } from '@tanstack/react-router'
import { PollStatusLabel } from '#/components/poll/status'
import { formatDateRange, formatDateTime } from '#/lib/format'
import { m } from '#/paraglide/messages'
import { getPollsDashboard } from '#/server/polls'

export const Route = createFileRoute('/_organizer/polls/')({
	loader: () => getPollsDashboard(),
	component: Polls,
})

/** Availability polls: find an evening that works for everyone (docs/availability-polls.md). */
function Polls() {
	const { polls, groups, canCreate } = Route.useLoaderData()

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 className="font-display text-[clamp(1.75rem,6vw,2.25rem)] font-semibold">
						{m.polls_title()}
					</h1>
					<p className="text-muted-foreground">{m.polls_intro()}</p>
				</div>
				{canCreate && (
					<Button asChild>
						<Link to="/polls/new">{m.poll_new()}</Link>
					</Button>
				)}
			</div>

			{polls.length === 0 ? (
				<p className="rounded-xl bg-card p-6">{m.polls_empty()}</p>
			) : (
				<ul className="flex flex-col gap-3">
					{polls.map((poll) => (
						<li key={poll.id}>
							<Link
								to="/polls/$pollId"
								params={{ pollId: poll.id }}
								className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card p-4 hover:bg-accent"
							>
								<span>
									<span className="block text-lg font-bold">{poll.title}</span>
									<span className="text-sm text-muted-foreground">
										{poll.confirmedStartsAt
											? formatDateTime(poll.confirmedStartsAt, poll.timezone)
											: formatDateRange(poll.startsOn, poll.endsOn)}
										{' · '}
										{m.poll_answers_count({ count: String(poll.responses) })}
									</span>
								</span>
								<PollStatusLabel status={poll.status} />
							</Link>
						</li>
					))}
				</ul>
			)}

			<section className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
				<div>
					<h2 className="font-bold">{m.poll_groups_title()}</h2>
					<p className="text-sm text-muted-foreground">
						{groups.length === 0
							? m.poll_groups_intro()
							: groups.map((group) => group.name).join(', ')}
					</p>
				</div>
				<Button variant="outline" asChild>
					<Link to="/polls/groups">{m.poll_groups_manage()}</Link>
				</Button>
			</section>
		</div>
	)
}
