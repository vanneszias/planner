import { authClient } from '@app/auth/client'
import type { Role } from '@app/auth/permissions'
import { Button } from '@app/ui/components/button'
import { ConfirmDialog } from '@app/ui/components/dialog'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { FormError } from '#/components/auth-shell'
import { Field, FieldInput, PrefixedInput } from '#/components/field'
import { PageHeader } from '#/components/page'
import { RadioCards } from '#/components/radio-cards'
import { actionMessage } from '#/lib/errors'
import { m } from '#/paraglide/messages'
import { getTeam, updateOrganizationFn } from '#/server/people'

export const Route = createFileRoute('/_organizer/team')({
	loader: () => getTeam(),
	component: Team,
})

const roleNames: Record<string, () => string> = {
	owner: m.role_owner,
	editor: m.role_editor,
	viewer: m.role_viewer,
}
const roleName = (role: string | null) => (role && roleNames[role] ? roleNames[role]() : '')

/** Collaborators (journeys.md, O3). Owners invite and remove; everyone can see who's on the team. */
function Team() {
	const { organization, members, invitations, currentUserId, canManage } = Route.useLoaderData()
	const router = useRouter()
	const [error, setError] = useState<string | null>(null)
	const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)

	async function remove(memberId: string) {
		setRemoving(null)
		const result = await authClient.organization.removeMember({
			memberIdOrEmail: memberId,
			organizationId: organization?.id,
		})
		if (result.error) return setError(m.error_forbidden())
		await router.invalidate()
	}

	async function cancel(invitationId: string) {
		const result = await authClient.organization.cancelInvitation({ invitationId })
		if (result.error) return setError(m.error_forbidden())
		await router.invalidate()
	}

	return (
		<div className="flex flex-col gap-6">
			<PageHeader title={m.team_title()} />

			<ul className="divide-y divide-border rounded-xl bg-card shadow-card">
				{members.map((member) => (
					<li key={member.memberId} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
						<span
							aria-hidden
							className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent font-bold text-muted-foreground uppercase"
						>
							{(member.name || member.email).slice(0, 1)}
						</span>
						<div className="min-w-0 flex-1">
							<p className="font-bold">
								{member.name || member.email}
								{member.userId === currentUserId && (
									<span className="font-normal text-muted-foreground"> ({m.you()})</span>
								)}
							</p>
							<p className="truncate text-sm text-muted-foreground">{member.email}</p>
						</div>
						<span className="rounded-full bg-accent px-2.5 py-0.5 text-sm font-bold">
							{roleName(member.role)}
						</span>
						{canManage && member.userId !== currentUserId && (
							<Button
								variant="ghost"
								size="sm"
								className="text-muted-foreground hover:bg-tint-danger hover:text-destructive"
								aria-label={`${m.remove_member()}: ${member.name || member.email}`}
								onClick={() =>
									setRemoving({ id: member.memberId, name: member.name || member.email })
								}
							>
								{m.remove_member()}
							</Button>
						)}
					</li>
				))}
			</ul>

			{invitations.length > 0 && (
				<section aria-labelledby="pending" className="flex flex-col gap-2">
					<h2 id="pending" className="font-bold">
						{m.pending_title()}
					</h2>
					<ul className="flex flex-col gap-2">
						{invitations.map((invitation) => (
							<li
								key={invitation.id}
								className="flex flex-wrap items-center gap-3 rounded-xl bg-card shadow-card p-4"
							>
								<p className="flex-1">{invitation.email}</p>
								<span className="rounded-full bg-accent px-3 py-1 text-sm font-bold">
									{roleName(invitation.role)}
								</span>
								{canManage && (
									<Button
										variant="ghost"
										size="sm"
										aria-label={`${m.cancel_invitation()}: ${invitation.email}`}
										onClick={() => cancel(invitation.id)}
									>
										{m.cancel_invitation()}
									</Button>
								)}
							</li>
						))}
					</ul>
				</section>
			)}

			<FormError message={error} />
			{canManage && organization && (
				<div className="grid items-start gap-6 lg:grid-cols-2">
					<InviteForm organizationId={organization.id} />
					<OrganizationForm organization={organization} />
				</div>
			)}
			<ConfirmDialog
				open={removing !== null}
				onOpenChange={(open) => !open && setRemoving(null)}
				title={removing ? m.remove_member_confirm({ name: removing.name }) : ''}
				confirmLabel={m.remove_member()}
				cancelLabel={m.cancel()}
				onConfirm={() => (removing ? remove(removing.id) : undefined)}
			/>
		</div>
	)
}

function InviteForm({ organizationId }: { organizationId: string }) {
	const router = useRouter()
	const [email, setEmail] = useState('')
	const [role, setRole] = useState<Role>('editor')
	const [issue, setIssue] = useState<string | undefined>()
	const [error, setError] = useState<string | null>(null)
	const [status, setStatus] = useState<string | null>(null)
	const [pending, setPending] = useState(false)

	async function submit(event: FormEvent) {
		event.preventDefault()
		setError(null)
		setStatus(null)
		if (!email.trim()) return setIssue('required')
		setPending(true)
		const result = await authClient.organization.inviteMember({ email, role, organizationId })
		setPending(false)
		if (result.error) {
			const code = result.error.code ?? ''
			if (code.includes('ALREADY_A_MEMBER')) setError(m.error_already_member())
			else if (code.includes('ALREADY_INVITED')) setError(m.error_already_invited())
			else if (result.error.status === 403) setError(m.error_forbidden())
			else setError(m.error_generic())
			return
		}
		setStatus(m.invite_sent({ email }))
		setEmail('')
		await router.invalidate()
	}

	return (
		<form
			onSubmit={submit}
			noValidate
			className="flex flex-col gap-4 rounded-xl bg-card shadow-card p-5"
		>
			<h2 className="font-display text-lg font-semibold">{m.invite_title()}</h2>
			<Field id="invite-email" label={m.invite_email_label()} error={issue}>
				<FieldInput
					id="invite-email"
					type="email"
					autoComplete="off"
					error={issue}
					value={email}
					onChange={(e) => {
						setEmail(e.target.value)
						setIssue(undefined)
					}}
				/>
			</Field>
			<RadioCards
				name="invite-role"
				legend={m.role_legend()}
				value={role}
				onChange={setRole}
				options={[
					{ value: 'editor', title: m.role_editor(), body: m.role_editor_body() },
					{ value: 'viewer', title: m.role_viewer(), body: m.role_viewer_body() },
					{ value: 'owner', title: m.role_owner(), body: m.role_owner_body() },
				]}
			/>
			<FormError message={error} />
			<div className="flex flex-wrap items-center gap-4">
				<Button type="submit" disabled={pending}>
					{m.invite_submit()}
				</Button>
				<p aria-live="polite" className="font-bold empty:hidden">
					{status}
				</p>
			</div>
		</form>
	)
}

/** Organization name and address. Renaming keeps old event links working (D19). */
function OrganizationForm({ organization }: { organization: { name: string; slug: string } }) {
	const router = useRouter()
	const [name, setName] = useState(organization.name)
	const [slug, setSlug] = useState(organization.slug)
	const [issues, setIssues] = useState<Record<string, string>>({})
	const [error, setError] = useState<string | null>(null)
	const [status, setStatus] = useState<string | null>(null)
	const [pending, setPending] = useState(false)

	async function submit(event: FormEvent) {
		event.preventDefault()
		setIssues({})
		setError(null)
		setStatus(null)
		setPending(true)
		const result = await updateOrganizationFn({ data: { name, slug } })
		setPending(false)
		if (!result.ok) {
			if (result.issues) setIssues(result.issues)
			else setError(actionMessage(result))
			return
		}
		setSlug(result.data.slug)
		setStatus(m.organization_saved())
		await router.invalidate()
	}

	return (
		<form
			onSubmit={submit}
			noValidate
			className="flex flex-col gap-4 rounded-xl bg-card shadow-card p-5"
		>
			<h2 className="font-display text-lg font-semibold">{m.organization_section()}</h2>
			<Field id="org-name" label={m.organization_name_label()} error={issues.name}>
				<FieldInput
					id="org-name"
					error={issues.name}
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
			</Field>
			<Field
				id="org-slug"
				label={m.web_address_label()}
				hint={m.web_address_hint()}
				error={issues.slug}
			>
				<PrefixedInput
					prefix="/"
					id="org-slug"
					hint
					error={issues.slug}
					value={slug}
					onChange={(e) => setSlug(e.target.value)}
				/>
			</Field>
			<FormError message={error} />
			<div className="flex flex-wrap items-center gap-4">
				<Button type="submit" disabled={pending}>
					{m.save_organization()}
				</Button>
				<p aria-live="polite" className="font-bold empty:hidden">
					{status}
				</p>
			</div>
		</form>
	)
}
