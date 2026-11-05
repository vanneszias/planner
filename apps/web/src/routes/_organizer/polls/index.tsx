import { Button } from '@app/ui/components/button'
import { createFileRoute, Link } from '@tanstack/react-router'
import { CalendarSearch, Plus } from 'lucide-react'
import { EmptyState, PageHeader } from '#/components/page'
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
			<PageHeader
				title={m.polls_title()}
				description={m.polls_intro()}
				action={
					canCreate && (
						<Button asChild>
							<Link to="/polls/new">
								<Plus />
								{m.poll_new()}
							</Link>
						</Button>
					)
				}
			/>

			{polls.length === 0 ? (
				<EmptyState icon={<CalendarSearch />} title={m.polls_empty()} />
			) : (
				<ul className="flex flex-col gap-3">
					{polls.map((poll) => (
						<li key={poll.id}>
							<Link
								to="/polls/$pollId"
								params={{ pollId: poll.id }}
								className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card p-4 shadow-card hover:bg-accent/60"
							>
								<span>
									<span className="block font-bold">{poll.title}</span>
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
