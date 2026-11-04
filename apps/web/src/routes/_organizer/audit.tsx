import { type AuditCategory, type AuditData, auditCategories } from '@app/domain'
import { Button } from '@app/ui/components/button'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { FieldSelect } from '#/components/field'
import { formatClock, formatDayStamp } from '#/lib/format'
import { m } from '#/paraglide/messages'
import { getAuditLogFn } from '#/server/audit'

type Search = { event?: string; category?: AuditCategory; person?: string; before?: string }

const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

/** Who did what in the organization (owners only): participant data reads included (D14). */
export const Route = createFileRoute('/_organizer/audit')({
	// Must accept its own output (TanStack validates search twice).
	validateSearch: (search: Record<string, unknown>): Search => ({
		event: text(search.event),
		category: auditCategories.find((c) => c === search.category),
		person: text(search.person),
		before: text(search.before),
	}),
	loaderDeps: ({ search }) => search,
	loader: ({ deps }) =>
		getAuditLogFn({
			data: {
				eventId: deps.event,
				category: deps.category,
				actorUserId: deps.person,
				before: deps.before,
			},
		}),
	component: AuditLog,
})

const categoryLabels: Record<AuditCategory, () => string> = {
	event: m.audit_category_event,
	workshop: m.audit_category_workshop,
	session: m.audit_category_session,
	age_groups: m.audit_category_age_groups,
	participants: m.audit_category_participants,
	preferences: m.audit_category_preferences,
	allocation: m.audit_category_allocation,
	checkin: m.audit_category_checkin,
	export: m.audit_category_export,
	retention: m.audit_category_retention,
	organization: m.audit_category_organization,
}

/** Plain words for each action; unknown ones show their code. */
const actionLabels: Record<string, () => string> = {
	'event.create': m.audit_event_create,
	'event.update': m.audit_event_update,
	'event.delete': m.audit_event_delete,
	'event.slug': m.audit_event_slug,
	'event.status.published': m.audit_event_published,
	'event.status.draft': m.audit_event_unpublished,
	'event.status.closed': m.audit_event_closed,
	'event.status.archived': m.audit_event_archived,
	'workshop.create': m.audit_workshop_create,
	'workshop.update': m.audit_workshop_update,
	'workshop.delete': m.audit_workshop_delete,
	'session.create': m.audit_session_create,
	'session.update': m.audit_session_update,
	'session.delete': m.audit_session_delete,
	'age_groups.save': m.audit_age_groups_save,
	'participants.list': m.audit_participants_list,
	'participants.add': m.audit_participants_add,
	'participants.import': m.audit_participants_import,
	'participants.credentials': m.audit_participants_credentials,
	'preferences.set': m.audit_preferences_set,
	'allocation.draft': m.audit_allocation_draft,
	'allocation.publish': m.audit_allocation_publish,
	'checkin.add': m.audit_checkin_add,
	'checkin.undo': m.audit_checkin_undo,
	'checkin.roster': m.audit_checkin_roster,
	'export.request': m.audit_export_request,
	'export.download': m.audit_export_download,
	'retention.anonymise': m.audit_retention_anonymise,
	'organization.update': m.audit_organization_update,
}

function AuditLog() {
	const { entries, next, events, members } = Route.useLoaderData()
	const search = Route.useSearch()
	const navigate = useNavigate({ from: Route.fullPath })
	// Any filter change starts again at the newest entry.
	const filter = (change: Partial<Search>) =>
		navigate({ search: (current) => ({ ...current, ...change, before: undefined }) })

	return (
		<div className="flex flex-col gap-5">
			<div>
				<h1 className="font-display text-[clamp(1.5rem,5vw,2.25rem)] leading-tight font-semibold">
					{m.audit_title()}
				</h1>
				<p className="text-muted-foreground">{m.audit_intro()}</p>
			</div>

			<div className="grid gap-3 sm:grid-cols-3">
				<label className="flex min-w-0 flex-col gap-1.5 text-sm font-bold">
					{m.audit_filter_event()}
					<FieldSelect
						value={search.event ?? ''}
						onChange={(e) => filter({ event: e.target.value || undefined })}
					>
						<option value="">{m.filter_all()}</option>
						{events.map((event) => (
							<option key={event.id} value={event.id}>
								{event.name}
							</option>
						))}
					</FieldSelect>
				</label>
				<label className="flex min-w-0 flex-col gap-1.5 text-sm font-bold">
					{m.audit_filter_category()}
					<FieldSelect
						value={search.category ?? ''}
						onChange={(e) =>
							filter({ category: (e.target.value || undefined) as AuditCategory | undefined })
						}
					>
						<option value="">{m.filter_all()}</option>
						{auditCategories.map((category) => (
							<option key={category} value={category}>
								{categoryLabels[category]()}
							</option>
						))}
					</FieldSelect>
				</label>
				<label className="flex min-w-0 flex-col gap-1.5 text-sm font-bold">
					{m.audit_filter_person()}
					<FieldSelect
						value={search.person ?? ''}
						onChange={(e) => filter({ person: e.target.value || undefined })}
					>
						<option value="">{m.filter_all()}</option>
						{members.map((member) => (
							<option key={member.id} value={member.id}>
								{member.name}
							</option>
						))}
					</FieldSelect>
				</label>
			</div>

			{entries.length === 0 ? (
				<p className="rounded-xl bg-card shadow-card p-6">{m.audit_empty()}</p>
			) : (
				<div className="overflow-hidden rounded-xl bg-card shadow-card sm:overflow-x-auto">
					<table className="w-full text-left text-sm">
						<caption className="sr-only">{m.audit_title()}</caption>
						<thead className="border-b border-border bg-accent/50 max-sm:sr-only text-xs tracking-wide text-muted-foreground uppercase">
							<tr>
								<th scope="col" className="p-3">
									{m.audit_column_when()}
								</th>
								<th scope="col" className="p-3">
									{m.audit_column_who()}
								</th>
								<th scope="col" className="p-3">
									{m.audit_column_what()}
								</th>
								<th scope="col" className="p-3">
									{m.audit_filter_event()}
								</th>
							</tr>
						</thead>
						<tbody>
							{collapse(entries).map((row) =>
								row.kind === 'day' ? (
									<tr key={row.key} className="border-b border-border bg-background/60">
										<th
											scope="colgroup"
											colSpan={4}
											className="px-3 py-2 text-left text-xs font-bold tracking-wide text-muted-foreground uppercase"
										>
											{row.label}
										</th>
									</tr>
								) : (
									<tr
										key={row.entry.id}
										className="border-b border-border align-top last:border-0 max-sm:grid max-sm:grid-cols-[6.5rem_minmax(0,1fr)] max-sm:gap-x-3 max-sm:px-3 max-sm:py-2.5 max-sm:[&>td]:p-0"
									>
										<td className="w-32 p-3 whitespace-nowrap text-muted-foreground tabular-nums max-sm:row-span-3">
											{clockRange(row.firstAt, row.entry.createdAt)}
										</td>
										<td className="p-3">
											{row.entry.actorKind === 'system'
												? m.audit_actor_system()
												: (row.entry.actorName ?? m.audit_actor_removed())}
										</td>
										<td className="p-3">
											<span className="flex flex-wrap items-center gap-2">
												{actionLabels[row.entry.action]?.() ?? row.entry.action}
												{row.count > 1 && (
													<span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold">
														{m.audit_repeated({ count: String(row.count) })}
													</span>
												)}
											</span>
											<Details data={row.entry.data} />
										</td>
										<td className="p-3 max-sm:text-muted-foreground">
											{row.entry.eventName ?? '—'}
										</td>
									</tr>
								),
							)}
						</tbody>
					</table>
				</div>
			)}

			<div className="flex flex-wrap gap-2">
				{search.before && (
					<Button variant="outline" asChild>
						<Link from={Route.fullPath} search={(current) => ({ ...current, before: undefined })}>
							{m.audit_newest()}
						</Link>
					</Button>
				)}
				{next && (
					<Button variant="outline" asChild>
						<Link from={Route.fullPath} search={(current) => ({ ...current, before: next })}>
							{m.audit_older()}
						</Link>
					</Button>
				)}
			</div>
		</div>
	)
}

type Entry = Awaited<ReturnType<typeof Route.useLoaderData>>['entries'][number]
type Row =
	| { kind: 'day'; key: string; label: string }
	| { kind: 'entry'; entry: Entry; count: number; firstAt: number }

const dayKey = (at: number) => new Date(at).toDateString()

/** "22:28–22:47" for a folded run; one time when it all happened in the same minute. */
function clockRange(from: number, to: number) {
	const [a, b] = [formatClock(from), formatClock(to)]
	return a === b ? a : `${a}–${b}`
}

/** Day headings, and runs of the same person doing the same thing folded into one row. */
function collapse(entries: Entry[]): Row[] {
	const rows: Row[] = []
	let last: Extract<Row, { kind: 'entry' }> | null = null
	for (const entry of entries) {
		const day = dayKey(entry.createdAt)
		if (!last || dayKey(last.entry.createdAt) !== day) {
			rows.push({ kind: 'day', key: day, label: formatDayStamp(entry.createdAt) })
			last = null
		}
		if (
			last &&
			JSON.stringify(entry.data) === JSON.stringify(last.entry.data) &&
			last.entry.action === entry.action &&
			last.entry.actorName === entry.actorName &&
			last.entry.eventName === entry.eventName
		) {
			last.count++
			last.firstAt = entry.createdAt
			continue
		}
		last = { kind: 'entry', entry, count: 1, firstAt: entry.createdAt }
		rows.push(last)
	}
	return rows
}

/** The few details entries carry: counts, kinds and changed fields. Never personal data. */
function Details({ data }: { data: AuditData | null }) {
	if (!data) return null
	const parts: string[] = []
	if (typeof data.count === 'number')
		parts.push(m.audit_detail_count({ count: String(data.count) }))
	if (typeof data.registrations === 'number')
		parts.push(m.audit_detail_count({ count: String(data.registrations) }))
	if (typeof data.kind === 'string') parts.push(data.kind)
	if (Array.isArray(data.fields)) parts.push(data.fields.join(', '))
	if (data.status === 'checked_in_anyway') parts.push(m.audit_detail_anyway())
	if (parts.length === 0) return null
	return <span className="block text-muted-foreground">{parts.join(' · ')}</span>
}
