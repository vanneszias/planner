import { Button } from '@app/ui/components/button'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { FormError } from '#/components/auth-shell'
import { Field, FieldInput } from '#/components/field'
import { actionMessage } from '#/lib/errors'
import { m } from '#/paraglide/messages'
import { deletePollGroupFn, getPollGroups, savePollGroupFn } from '#/server/polls'

export const Route = createFileRoute('/_organizer/polls/groups')({
	loader: () => getPollGroups(),
	component: Groups,
})

type Page = Awaited<ReturnType<typeof getPollGroups>>

/**
 * Groups of organization members (a prayer group, a band) to invite by email
 * in one go. Only members can be in a group: invite people on the Team page first.
 */
function Groups() {
	const page: Page = Route.useLoaderData()
	const [editing, setEditing] = useState<string | 'new' | null>(null)

	return (
		<div className="flex flex-col gap-6">
			<div>
				<p className="text-sm text-muted-foreground">
					<Link to="/polls" className="underline underline-offset-4">
						{m.polls_title()}
					</Link>
				</p>
				<h1 className="font-display text-[clamp(1.5rem,5vw,2rem)] font-semibold">
					{m.poll_groups_title()}
				</h1>
				<p className="text-muted-foreground">
					{m.poll_groups_page_intro()}{' '}
					<Link to="/team" className="underline underline-offset-4">
						{m.nav_team()}
					</Link>
				</p>
			</div>

			<ul className="flex flex-col gap-3">
				{page.groups.map((group) =>
					editing === group.id ? (
						<li key={group.id}>
							<GroupForm page={page} group={group} onDone={() => setEditing(null)} />
						</li>
					) : (
						<li
							key={group.id}
							className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card p-4"
						>
							<span>
								<span className="block font-bold">{group.name}</span>
								<span className="text-sm text-muted-foreground">
									{page.members
										.filter((member) => group.userIds.includes(member.userId))
										.map((member) => member.name || member.email)
										.join(', ') || m.poll_group_empty()}
								</span>
							</span>
							{page.canEdit && (
								<Button variant="outline" onClick={() => setEditing(group.id)}>
									{m.poll_group_edit()}
								</Button>
							)}
						</li>
					),
				)}
			</ul>

			{page.canEdit &&
				(editing === 'new' ? (
					<GroupForm page={page} group={null} onDone={() => setEditing(null)} />
				) : (
					<div>
						<Button onClick={() => setEditing('new')}>{m.poll_group_new()}</Button>
					</div>
				))}
		</div>
	)
}

function GroupForm({
	page,
	group,
	onDone,
}: {
	page: Page
	group: Page['groups'][number] | null
	onDone: () => void
}) {
	const router = useRouter()
	const [name, setName] = useState(group?.name ?? '')
	const [userIds, setUserIds] = useState<string[]>(group?.userIds ?? [])
	const [issues, setIssues] = useState<Record<string, string>>({})
	const [error, setError] = useState<string | null>(null)
	const [pending, setPending] = useState(false)

	async function submit(event: FormEvent) {
		event.preventDefault()
		if (!name.trim()) return setIssues({ name: 'required' })
		setPending(true)
		const result = await savePollGroupFn({
			data: { groupId: group?.id ?? null, values: { name, userIds } },
		})
		setPending(false)
		if (!result.ok) {
			if (result.issues) setIssues(result.issues)
			else setError(actionMessage(result))
			return
		}
		await router.invalidate()
		onDone()
	}

	async function remove() {
		if (!group || !globalThis.confirm(m.poll_group_delete_prompt())) return
		setPending(true)
		const result = await deletePollGroupFn({ data: group.id })
		setPending(false)
		if (!result.ok) return setError(actionMessage(result))
		await router.invalidate()
		onDone()
	}

	return (
		<form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-xl bg-card p-5">
			<Field id="group-name" label={m.poll_group_name()} error={issues.name}>
				<FieldInput
					id="group-name"
					error={issues.name}
					value={name}
					onChange={(e) => setName(e.target.value)}
					autoFocus
				/>
			</Field>
			<fieldset className="flex flex-col gap-1">
				<legend className="mb-2 font-bold">{m.poll_group_members()}</legend>
				{page.members.map((member) => (
					<label key={member.userId} className="flex min-h-11 cursor-pointer items-center gap-3">
						<input
							type="checkbox"
							checked={userIds.includes(member.userId)}
							onChange={(e) =>
								setUserIds((ids) =>
									e.target.checked
										? [...ids, member.userId]
										: ids.filter((id) => id !== member.userId),
								)
							}
							className="size-5 shrink-0 accent-[var(--kelp)]"
						/>
						<span>
							{member.name || member.email}
							{member.name && (
								<span className="block text-sm text-muted-foreground">{member.email}</span>
							)}
						</span>
					</label>
				))}
			</fieldset>
			<FormError message={error} />
			<div className="flex flex-wrap gap-3">
				<Button type="submit" disabled={pending}>
					{m.poll_group_save()}
				</Button>
				<Button type="button" variant="ghost" onClick={onDone}>
					{m.cancel()}
				</Button>
				{group && (
					<Button type="button" variant="destructive" disabled={pending} onClick={remove}>
						{m.delete()}
					</Button>
				)}
			</div>
		</form>
	)
}
