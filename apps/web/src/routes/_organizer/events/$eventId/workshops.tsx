import type { Workshop, WorkshopInput } from '@app/domain'
import { Button } from '@app/ui/components/button'
import { Marker } from '@app/ui/components/marker'
import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { FormError } from '#/components/auth-shell'
import { Field, FieldInput } from '#/components/field'
import { actionMessage } from '#/lib/errors'
import { m } from '#/paraglide/messages'
import { deleteWorkshopFn, saveWorkshopFn } from '#/server/events'

export const Route = createFileRoute('/_organizer/events/$eventId/workshops')({
	component: Workshops,
})
const eventRoute = getRouteApi('/_organizer/events/$eventId')

function Workshops() {
	const { event, workshops, canEdit, ageGroups, workshopAgeGroups } = eventRoute.useLoaderData()
	const labelOf = new Map(ageGroups.map((group) => [group.id, group.label]))
	const router = useRouter()
	// null: no form open; 'new': adding; otherwise the workshop being edited.
	const [editing, setEditing] = useState<'new' | Workshop | null>(null)

	async function remove(workshop: Workshop) {
		if (!window.confirm(m.delete_workshop_confirm({ title: workshop.title }))) return
		await deleteWorkshopFn({ data: workshop.id })
		await router.invalidate()
	}

	return (
		<div className="flex flex-col gap-4">
			{canEdit && editing === null && (
				<div>
					<Button onClick={() => setEditing('new')}>{m.add_workshop()}</Button>
				</div>
			)}

			{editing === 'new' && (
				<WorkshopForm
					eventId={event.id}
					onDone={async () => {
						setEditing(null)
						await router.invalidate()
					}}
				/>
			)}

			{workshops.length === 0 && editing === null && (
				<p className="rounded-xl bg-card p-6">{m.workshops_empty()}</p>
			)}

			<ul className="flex flex-col gap-3">
				{workshops.map((workshop) =>
					editing !== null && editing !== 'new' && editing.id === workshop.id ? (
						<li key={workshop.id}>
							<WorkshopForm
								eventId={event.id}
								workshop={workshop}
								onDone={async () => {
									setEditing(null)
									await router.invalidate()
								}}
							/>
						</li>
					) : (
						<li key={workshop.id} className="flex items-start gap-3 rounded-xl bg-card p-4">
							<Marker color={workshop.markerColor} shape={workshop.markerShape} className="mt-1" />
							<div className="flex-1">
								<p className="font-bold">{workshop.title}</p>
								{workshop.facilitatorName && (
									<p className="text-sm text-muted-foreground">{workshop.facilitatorName}</p>
								)}
								{workshopAgeGroups[workshop.id]?.length ? (
									<p className="text-sm font-bold">
										{m.for_ages({
											groups: (workshopAgeGroups[workshop.id] ?? [])
												.map((id) => labelOf.get(id))
												.join(', '),
										})}
									</p>
								) : null}
								{workshop.description && <p className="mt-1 text-sm">{workshop.description}</p>}
							</div>
							{canEdit && (
								<div className="flex gap-1">
									<Button
										variant="ghost"
										aria-label={`${m.edit()}: ${workshop.title}`}
										onClick={() => setEditing(workshop)}
									>
										{m.edit()}
									</Button>
									<Button
										variant="ghost"
										aria-label={`${m.delete()}: ${workshop.title}`}
										onClick={() => remove(workshop)}
									>
										{m.delete()}
									</Button>
								</div>
							)}
						</li>
					),
				)}
			</ul>
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
	})
	const [issues, setIssues] = useState<Record<string, string>>({})
	const [error, setError] = useState<string | null>(null)
	const [pending, setPending] = useState(false)
	const set = (key: Exclude<keyof WorkshopInput, 'ageGroupIds'>, value: string) =>
		setValues((v) => ({ ...v, [key]: value }))

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
		<form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-xl bg-card p-5">
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
					className="rounded-md border border-input bg-card px-3 py-2"
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
			<div className="flex gap-2">
				<Button type="submit" disabled={pending}>
					{m.save_workshop()}
				</Button>
				<Button type="button" variant="ghost" onClick={() => onDone()}>
					{m.cancel()}
				</Button>
			</div>
		</form>
	)
}
