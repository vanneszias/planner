import type { Workshop, WorkshopInput } from '@app/domain'
import { Button } from '@app/ui/components/button'
import { ConfirmDialog, Dialog } from '@app/ui/components/dialog'
import { Marker } from '@app/ui/components/marker'
import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { Plus, Shapes } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { FormError } from '#/components/auth-shell'
import { Field, FieldInput, FormActions } from '#/components/field'
import { MarkerPicker } from '#/components/marker-picker'
import { EmptyState, PageToolbar, RowActions } from '#/components/page'
import { actionMessage } from '#/lib/errors'
import { m } from '#/paraglide/messages'
import { deleteWorkshopFn, saveWorkshopFn } from '#/server/events'

export const Route = createFileRoute('/_organizer/events/$eventId/workshops')({
	component: Workshops,
})
const eventRoute = getRouteApi('/_organizer/events/$eventId')

function Workshops() {
	const { event, workshops, sessions, canEdit, ageGroups, workshopAgeGroups } =
		eventRoute.useLoaderData()
	const labelOf = new Map(ageGroups.map((group) => [group.id, group.label]))
	const router = useRouter()
	// null: no form open; 'new': adding; otherwise the workshop being edited.
	const [editing, setEditing] = useState<'new' | Workshop | null>(null)
	const [deleting, setDeleting] = useState<Workshop | null>(null)

	const stats = new Map<string, { sessions: number; places: number }>()
	for (const session of sessions) {
		const current = stats.get(session.workshopId) ?? { sessions: 0, places: 0 }
		stats.set(session.workshopId, {
			sessions: current.sessions + 1,
			places: current.places + session.capacity,
		})
	}

	return (
		<div className="flex flex-col gap-6">
			<PageToolbar summary={m.workshops_summary({ count: String(workshops.length) })}>
				{canEdit && (
					<Button onClick={() => setEditing('new')}>
						<Plus />
						{m.add_workshop()}
					</Button>
				)}
			</PageToolbar>

			{workshops.length === 0 && <EmptyState icon={<Shapes />} title={m.workshops_empty()} />}

			{workshops.length > 0 && (
				<ul className="divide-y divide-border overflow-hidden rounded-xl bg-card shadow-card">
					{workshops.map((workshop) => {
						const groups = (workshopAgeGroups[workshop.id] ?? []).map((id) => labelOf.get(id))
						const stat = stats.get(workshop.id)
						return (
							<li
								key={workshop.id}
								className="group flex items-center gap-3 px-4 py-3 hover:bg-accent/30"
							>
								<Marker
									color={workshop.markerColor}
									shape={workshop.markerShape}
									className="mt-0.5"
								/>
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
										{canEdit ? (
											<button
												type="button"
												className="text-left font-bold hover:underline hover:underline-offset-4"
												onClick={() => setEditing(workshop)}
											>
												{workshop.title}
											</button>
										) : (
											<p className="font-bold">{workshop.title}</p>
										)}
										{groups.length > 0 && (
											<span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold">
												{m.for_ages({ groups: groups.join(', ') })}
											</span>
										)}
									</div>
									<p className="text-sm text-muted-foreground">
										{[
											workshop.facilitatorName,
											stat
												? `${m.workshop_sessions({ count: String(stat.sessions) })} · ${m.workshop_places_total({ count: String(stat.places) })}`
												: m.no_sessions_yet(),
										]
											.filter(Boolean)
											.join(' · ')}
									</p>
									{workshop.description && (
										<p className="mt-1 line-clamp-2 text-sm">{workshop.description}</p>
									)}
								</div>
								{canEdit && (
									<RowActions
										label={workshop.title}
										onEdit={() => setEditing(workshop)}
										onDelete={() => setDeleting(workshop)}
									/>
								)}
							</li>
						)
					})}
				</ul>
			)}

			<Dialog
				open={editing !== null}
				onOpenChange={(open) => !open && setEditing(null)}
				title={editing === 'new' ? m.add_workshop() : (editing?.title ?? '')}
				description={editing !== null && editing !== 'new' ? m.edit_workshop_title() : undefined}
				icon={
					editing !== null &&
					editing !== 'new' && <Marker color={editing.markerColor} shape={editing.markerShape} />
				}
				closeLabel={m.close()}
			>
				{editing !== null && (
					<WorkshopForm
						eventId={event.id}
						workshop={editing === 'new' ? undefined : editing}
						onDone={async () => {
							setEditing(null)
							await router.invalidate()
						}}
					/>
				)}
			</Dialog>
			<ConfirmDialog
				open={deleting !== null}
				onOpenChange={(open) => !open && setDeleting(null)}
				title={deleting ? m.delete_workshop_title({ title: deleting.title }) : ''}
				description={m.delete_workshop_body()}
				confirmLabel={m.delete()}
				cancelLabel={m.cancel()}
				onConfirm={async () => {
					if (!deleting) return
					await deleteWorkshopFn({ data: deleting.id })
					setDeleting(null)
					await router.invalidate()
				}}
			/>
		</div>
	)
}

function WorkshopForm({
	eventId,
	workshop,
	onDone,
}: {
	eventId: string
	workshop?: Workshop
	onDone: () => Promise<void>
}) {
	const { ageGroups, workshopAgeGroups } = eventRoute.useLoaderData()
	const [values, setValues] = useState<WorkshopInput>({
		title: workshop?.title ?? '',
		description: workshop?.description ?? '',
		facilitatorName: workshop?.facilitatorName ?? '',
		category: workshop?.category ?? '',
		ageGroupIds: workshop ? (workshopAgeGroups[workshop.id] ?? []) : [],
		markerColor: workshop?.markerColor,
		markerShape: workshop?.markerShape,
	})
	const [issues, setIssues] = useState<Record<string, string>>({})
	const [error, setError] = useState<string | null>(null)
	const [pending, setPending] = useState(false)
	const set = (
		key: Exclude<keyof WorkshopInput, 'ageGroupIds' | 'markerColor' | 'markerShape'>,
		value: string,
	) => setValues((v) => ({ ...v, [key]: value }))

	async function submit(event: FormEvent) {
		event.preventDefault()
		setError(null)
		if (!values.title.trim()) return setIssues({ title: 'required' })
		setPending(true)
		const result = await saveWorkshopFn({
			data: { eventId, workshopId: workshop?.id, values },
		})
		setPending(false)
		if (result.ok) return onDone()
		if (result.issues) setIssues(result.issues)
		else setError(actionMessage(result))
	}

	const prefix = workshop?.id ?? 'new'
	return (
		<form onSubmit={submit} noValidate className="flex flex-col gap-5">
			<Field id={`${prefix}-title`} label={m.workshop_title_label()} error={issues.title}>
				<FieldInput
					id={`${prefix}-title`}
					error={issues.title}
					value={values.title}
					onChange={(e) => set('title', e.target.value)}
					autoFocus
				/>
			</Field>
			<Field id={`${prefix}-description`} label={m.description_label()} error={issues.description}>
				<textarea
					id={`${prefix}-description`}
					rows={3}
					className="rounded-md border border-input bg-card px-3 py-2 shadow-xs"
					value={values.description}
					onChange={(e) => set('description', e.target.value)}
				/>
			</Field>
			<div className="grid gap-4 sm:grid-cols-2">
				<Field
					id={`${prefix}-facilitator`}
					label={m.facilitator_label()}
					error={issues.facilitatorName}
				>
					<FieldInput
						id={`${prefix}-facilitator`}
						error={issues.facilitatorName}
						value={values.facilitatorName}
						onChange={(e) => set('facilitatorName', e.target.value)}
					/>
				</Field>
				<Field id={`${prefix}-category`} label={m.category_label()} error={issues.category}>
					<FieldInput
						id={`${prefix}-category`}
						error={issues.category}
						value={values.category}
						onChange={(e) => set('category', e.target.value)}
					/>
				</Field>
			</div>
			{workshop && values.markerColor && values.markerShape && (
				<MarkerPicker
					color={values.markerColor}
					shape={values.markerShape}
					onChange={(marker) => setValues((v) => ({ ...v, ...marker }))}
				/>
			)}
			{ageGroups.length > 0 && (
				<fieldset className="flex flex-col gap-1">
					<legend className="font-bold">{m.who_can_join()}</legend>
					<p className="mb-1 text-sm text-muted-foreground">{m.everyone_hint()}</p>
					{ageGroups.map((group) => (
						<label key={group.id} className="flex min-h-11 cursor-pointer items-center gap-3">
							<input
								type="checkbox"
								className="size-5 accent-[var(--kelp)]"
								checked={values.ageGroupIds?.includes(group.id) ?? false}
								onChange={(e) =>
									setValues((v) => ({
										...v,
										ageGroupIds: e.target.checked
											? [...(v.ageGroupIds ?? []), group.id]
											: (v.ageGroupIds ?? []).filter((id) => id !== group.id),
									}))
								}
							/>
							{group.label}
						</label>
					))}
				</fieldset>
			)}
			<FormError message={error} />
			<FormActions>
				<Button type="button" variant="outline" onClick={() => onDone()}>
					{m.cancel()}
				</Button>
				<Button type="submit" disabled={pending}>
					{m.save_workshop()}
				</Button>
			</FormActions>
		</form>
	)
}
