import { Button } from '@app/ui/components/button'
import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { type FormEvent, useMemo, useState } from 'react'
import { FormError } from '#/components/auth-shell'
import { RankList } from '#/components/event/rank-list'
import { Field, FieldInput } from '#/components/field'
import { actionMessage, fieldMessage } from '#/lib/errors'
import { m } from '#/paraglide/messages'
import {
	addMinorFn,
	emailGuardiansFn,
	getParticipantsFn,
	getRankingForFn,
	importMinorsFn,
	issueCardsFn,
	setRankingForFn,
} from '#/server/participants'

export const Route = createFileRoute('/_organizer/events/$eventId/participants')({
	loader: ({ params }) => getParticipantsFn({ data: params.eventId }),
	component: Participants,
})
const eventRoute = getRouteApi('/_organizer/events/$eventId')

type Card = { id: string; firstName: string; code: string; qr: string }
type Panel = 'add' | 'import' | { confirm: 'cards' | 'email' } | null
type RankingPanel = {
	id: string
	name: string
	ranking: string[]
	rankable: string[]
	rules: { min: number; max: number }
}

/** Participants (journeys.md, O4): list, add, import, code cards, guardian emails. */
function Participants() {
	const { participants, ageGroups, canWrite } = Route.useLoaderData()
	const { event, workshops } = eventRoute.useLoaderData()
	const router = useRouter()
	const [ranking, setRanking] = useState<RankingPanel | null>(null)
	const ranks = event.mode === 'ranking'
	const [ageFilter, setAgeFilter] = useState('')
	const [statusFilter, setStatusFilter] = useState<'all' | 'none' | 'waitlisted'>('all')
	const [selected, setSelected] = useState<Set<string>>(new Set())
	const [panel, setPanel] = useState<Panel>(null)
	const [cards, setCards] = useState<Card[] | null>(null)
	const [status, setStatus] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	const groupLabel = new Map(ageGroups.map((g) => [g.id, g.label]))
	const visible = useMemo(
		() =>
			participants.filter(
				(p) =>
					(!ageFilter || p.ageGroupId === ageFilter) &&
					(statusFilter === 'all' ||
						(statusFilter === 'none' && p.bookings === 0) ||
						(statusFilter === 'waitlisted' && p.waitlisted > 0)),
			),
		[participants, ageFilter, statusFilter],
	)
	const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id))

	function toggle(id: string, on: boolean) {
		setSelected((current) => {
			const next = new Set(current)
			if (on) next.add(id)
			else next.delete(id)
			return next
		})
	}

	async function confirmed(kind: 'cards' | 'email') {
		setPanel(null)
		setError(null)
		const ids = [...selected]
		if (kind === 'cards') {
			const result = await issueCardsFn({ data: { eventId: event.id, registrationIds: ids } })
			if (!result.ok) return setError(actionMessage(result))
			setCards(result.data)
		} else {
			const result = await emailGuardiansFn({ data: { eventId: event.id, registrationIds: ids } })
			if (!result.ok) return setError(actionMessage(result))
			setStatus(
				m.guardians_emailed({
					sent: String(result.data.sent),
					skipped: String(result.data.skipped),
				}),
			)
		}
	}

	async function openRanking(id: string, name: string) {
		setError(null)
		const result = await getRankingForFn({ data: { eventId: event.id, registrationId: id } })
		if (!result.ok) return setError(actionMessage(result))
		setRanking({ id, name, ...result.data })
	}

	async function saveRanking(panel: RankingPanel, workshopIds: string[]) {
		const result = await setRankingForFn({
			data: { eventId: event.id, registrationId: panel.id, workshopIds },
		})
		if (!result.ok) return actionMessage(result)
		if (!result.data.ok) {
			return result.data.reason === 'not_eligible' ? m.move_not_eligible() : m.error_generic()
		}
		await router.invalidate()
		return null
	}

	if (cards) {
		return (
			<div className="flex flex-col gap-4">
				<div className="flex flex-wrap items-center gap-3 print:hidden">
					<p className="font-bold">{m.cards_ready()}</p>
					<Button onClick={() => window.print()}>{m.print_now()}</Button>
					<Button variant="ghost" onClick={() => setCards(null)}>
						{m.back_to_list()}
					</Button>
				</div>
				{/* Eight cards per A4 page when printed. */}
				<ul className="grid grid-cols-2 gap-3 print:gap-0">
					{cards.map((card) => (
						<li
							key={card.id}
							className="flex break-inside-avoid flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 text-center print:h-[68mm] print:rounded-none print:border-dashed"
						>
							<p className="font-display text-lg font-semibold" lang={event.defaultLocale}>
								{event.name}
							</p>
							<p className="text-xl font-bold">{card.firstName}</p>
							{/* Decorative: the printed code below is the text alternative. */}
							<img
								alt=""
								className="size-28"
								src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(card.qr)}`}
							/>
							<p className="font-mono text-2xl tracking-widest">{card.code}</p>
							<p className="text-xs text-muted-foreground">{m.card_hint()}</p>
						</li>
					))}
				</ul>
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="font-bold">{m.participants_count({ count: String(participants.length) })}</p>
				{canWrite && (
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" onClick={() => setPanel(panel === 'add' ? null : 'add')}>
							{m.add_participant()}
						</Button>
						<Button
							variant="outline"
							onClick={() => setPanel(panel === 'import' ? null : 'import')}
						>
							{m.import_csv()}
						</Button>
					</div>
				)}
			</div>

			{panel === 'add' && (
				<AddForm
					eventId={event.id}
					ageGroups={ageGroups}
					onDone={async (name) => {
						setPanel(null)
						setStatus(m.participant_added({ name }))
						await router.invalidate()
					}}
				/>
			)}
			{panel === 'import' && (
				<ImportForm
					eventId={event.id}
					onDone={async (count) => {
						setPanel(null)
						setStatus(m.import_done({ count: String(count) }))
						await router.invalidate()
					}}
				/>
			)}

			<p aria-live="polite" role="status" className="font-bold empty:hidden">
				{status}
			</p>
			<FormError message={error} />

			{ranking && (
				<div className="flex flex-col gap-3 rounded-xl bg-card p-5">
					<RankList
						key={ranking.id}
						title={m.ranking_for({ name: ranking.name })}
						savedMessage={m.ranking_saved_for({ name: ranking.name })}
						saveLabel={m.save_ranking_for()}
						contentLocale={event.defaultLocale}
						initial={ranking.ranking}
						rules={ranking.rules}
						onSave={(ids) => saveRanking(ranking, ids)}
						workshops={workshops
							.filter((w) => ranking.rankable.includes(w.id))
							.map((w) => ({
								id: w.id,
								title: w.title,
								markerColor: w.markerColor,
								markerShape: w.markerShape,
								times: [],
							}))}
					/>
					<div>
						<Button variant="ghost" onClick={() => setRanking(null)}>
							{m.back_to_list()}
						</Button>
					</div>
				</div>
			)}

			{participants.length === 0 ? (
				<p className="rounded-xl bg-card p-6">{m.participants_empty()}</p>
			) : (
				<>
					<div className="flex flex-wrap items-end gap-3">
						{ageGroups.length > 0 && (
							<label className="flex flex-col gap-1 text-sm font-bold">
								{m.filter_age_group()}
								<select
									className="h-11 rounded-md border border-input bg-card px-3 font-normal"
									value={ageFilter}
									onChange={(e) => setAgeFilter(e.target.value)}
								>
									<option value="">{m.filter_all()}</option>
									{ageGroups.map((g) => (
										<option key={g.id} value={g.id}>
											{g.label}
										</option>
									))}
								</select>
							</label>
						)}
						<label className="flex flex-col gap-1 text-sm font-bold">
							{m.filter_status()}
							<select
								className="h-11 rounded-md border border-input bg-card px-3 font-normal"
								value={statusFilter}
								onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
							>
								<option value="all">{m.filter_all()}</option>
								<option value="none">{m.filter_no_bookings()}</option>
								<option value="waitlisted">{m.filter_waitlisted()}</option>
							</select>
						</label>
					</div>

					{canWrite && selected.size > 0 && (
						<div className="flex flex-wrap gap-2">
							<Button onClick={() => setPanel({ confirm: 'cards' })}>{m.print_cards()}</Button>
							<Button variant="outline" onClick={() => setPanel({ confirm: 'email' })}>
								{m.email_guardians()}
							</Button>
						</div>
					)}
					{panel && typeof panel === 'object' && (
						<div className="flex flex-col gap-3 rounded-xl bg-tint-warning p-4">
							<p>{m.new_codes_warning({ count: String(selected.size) })}</p>
							<div className="flex gap-2">
								<Button onClick={() => confirmed(panel.confirm)}>{m.confirm_continue()}</Button>
								<Button variant="ghost" onClick={() => setPanel(null)}>
									{m.cancel()}
								</Button>
							</div>
						</div>
					)}

					<div className="overflow-x-auto rounded-xl bg-card">
						<table className="w-full text-left text-sm">
							<thead className="border-b border-border">
								<tr>
									{canWrite && (
										<th className="w-12 p-3">
											<input
												type="checkbox"
												aria-label={m.select_all()}
												className="size-5 accent-[var(--kelp)]"
												checked={allVisibleSelected}
												onChange={(e) => {
													for (const p of visible) toggle(p.id, e.target.checked)
												}}
											/>
										</th>
									)}
									<th className="p-3">{m.column_name()}</th>
									<th className="p-3">{m.column_contact()}</th>
									<th className="p-3">{m.column_sessions()}</th>
									<th className="p-3">{m.column_waitlist()}</th>
									{ranks && <th className="p-3">{m.column_ranked()}</th>}
								</tr>
							</thead>
							<tbody>
								{visible.map((p) => (
									<tr key={p.id} className="border-b border-border last:border-0">
										{canWrite && (
											<td className="p-3">
												<input
													type="checkbox"
													aria-label={m.select_participant({ name: p.displayName })}
													className="size-5 accent-[var(--kelp)]"
													checked={selected.has(p.id)}
													onChange={(e) => toggle(p.id, e.target.checked)}
												/>
											</td>
										)}
										<td className="p-3">
											<span className="font-bold">{p.displayName}</span>
											<span className="block text-muted-foreground">
												{[
													p.ageGroupId ? groupLabel.get(p.ageGroupId) : null,
													p.isMinor ? m.minor() : null,
													p.registeredBy === 'organizer' ? m.added_by_organizer() : null,
												]
													.filter(Boolean)
													.join(' · ')}
											</span>
										</td>
										<td className="p-3 break-all">{p.email ?? p.guardianEmail ?? '—'}</td>
										<td className="p-3 font-mono">{p.bookings}</td>
										<td className="p-3 font-mono">{p.waitlisted || '—'}</td>
										{ranks && (
											<td className="p-3">
												<span className="block">{p.ranked ? m.ranked_yes() : m.ranked_no()}</span>
												{canWrite && (
													<Button
														variant="ghost"
														className="h-9 px-2 text-sm"
														aria-label={m.enter_ranking_for({ name: p.displayName })}
														onClick={() => openRanking(p.id, p.displayName)}
													>
														{m.enter_ranking()}
													</Button>
												)}
											</td>
										)}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</>
			)}
		</div>
	)
}

function AddForm({
	eventId,
	ageGroups,
	onDone,
}: {
	eventId: string
	ageGroups: { id: string; label: string }[]
	onDone: (name: string) => Promise<void>
}) {
	const [name, setName] = useState('')
	const [ageGroupId, setAgeGroupId] = useState(ageGroups[0]?.id ?? '')
	const [guardianEmail, setGuardianEmail] = useState('')
	const [issues, setIssues] = useState<Record<string, string>>({})
	const [pending, setPending] = useState(false)

	async function submit(event: FormEvent) {
		event.preventDefault()
		if (!name.trim()) return setIssues({ name: 'required' })
		setPending(true)
		const result = await addMinorFn({
			data: { eventId, values: { name, ageGroupId: ageGroupId || undefined, guardianEmail } },
		})
		setPending(false)
		if (!result.ok) return setIssues(result.issues ?? {})
		await onDone(name)
	}

	return (
		<form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-xl bg-card p-5">
			<Field id="minor-name" label={m.participant_name_label()} error={issues.name}>
				<FieldInput
					id="minor-name"
					error={issues.name}
					value={name}
					onChange={(e) => setName(e.target.value)}
					autoFocus
				/>
			</Field>
			{ageGroups.length > 0 && (
				<Field id="minor-age" label={m.age_group_select()}>
					<select
						id="minor-age"
						className="h-11 rounded-md border border-input bg-card px-3"
						value={ageGroupId}
						onChange={(e) => setAgeGroupId(e.target.value)}
					>
						{ageGroups.map((g) => (
							<option key={g.id} value={g.id}>
								{g.label}
							</option>
						))}
					</select>
				</Field>
			)}
			<Field id="minor-guardian" label={m.guardian_email_label()} error={issues.guardianEmail}>
				<FieldInput
					id="minor-guardian"
					type="email"
					error={issues.guardianEmail}
					value={guardianEmail}
					onChange={(e) => setGuardianEmail(e.target.value)}
				/>
			</Field>
			<div>
				<Button type="submit" disabled={pending}>
					{m.save_participant()}
				</Button>
			</div>
		</form>
	)
}

function ImportForm({
	eventId,
	onDone,
}: {
	eventId: string
	onDone: (count: number) => Promise<void>
}) {
	const [csv, setCsv] = useState('')
	const [checked, setChecked] = useState<{
		rows: number
		problems: { row: number; field: string; code: string }[]
	} | null>(null)
	const [pending, setPending] = useState(false)

	async function check(commit: boolean) {
		setPending(true)
		const result = await importMinorsFn({ data: { eventId, csv, commit } })
		setPending(false)
		if (!result.ok)
			return setChecked({ rows: 0, problems: [{ row: 1, field: 'csv', code: 'too_long' }] })
		if (commit && result.data.imported > 0) return onDone(result.data.imported)
		setChecked(result.data)
	}

	return (
		<div className="flex flex-col gap-4 rounded-xl bg-card p-5">
			<div>
				<h2 className="text-lg font-bold">{m.import_title()}</h2>
				<p className="text-sm text-muted-foreground">{m.import_hint()}</p>
			</div>
			<Field id="import-file" label={m.import_file_label()}>
				<input
					id="import-file"
					type="file"
					accept=".csv,text/csv"
					className="min-h-11"
					onChange={async (e) => {
						const file = e.target.files?.[0]
						setChecked(null)
						setCsv(file ? await file.text() : '')
					}}
				/>
			</Field>
			{checked && checked.problems.length > 0 && (
				<div role="alert" className="flex flex-col gap-1 rounded-lg bg-tint-danger p-3 text-sm">
					<p className="font-bold">{m.import_problems()}</p>
					<ul className="list-disc pl-5">
						{checked.problems.slice(0, 20).map((p) => (
							<li key={`${p.row}-${p.field}`}>
								{m.import_row_problem({
									row: String(p.row),
									field: p.field,
									problem: fieldMessage(p.code) ?? p.code,
								})}
							</li>
						))}
					</ul>
				</div>
			)}
			{checked && checked.problems.length === 0 && (
				<p className="font-bold">{m.import_ready({ count: String(checked.rows) })}</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button variant="outline" disabled={!csv || pending} onClick={() => check(false)}>
					{m.import_check()}
				</Button>
				{checked && checked.problems.length === 0 && (
					<Button disabled={pending} onClick={() => check(true)}>
						{m.import_confirm({ count: String(checked.rows) })}
					</Button>
				)}
			</div>
		</div>
	)
}
