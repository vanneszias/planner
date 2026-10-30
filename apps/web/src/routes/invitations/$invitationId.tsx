import { authClient } from '@app/auth/client'
import { Button } from '@app/ui/components/button'
import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { AuthShell, FormError } from '#/components/auth-shell'
import { m } from '#/paraglide/messages'
import { getInvitation } from '#/server/people'

/** Accepting a team invitation (journeys.md, O3). Signed-out visitors sign in first and return. */
export const Route = createFileRoute('/invitations/$invitationId')({
	loader: async ({ params }) => {
		const invitation = await getInvitation({ data: params.invitationId })
		if (invitation.state === 'missing') throw notFound()
		return invitation
	},
	component: Invitation,
})

const roleNames = { owner: m.role_owner, editor: m.role_editor, viewer: m.role_viewer }

function Invitation() {
	const invitation = Route.useLoaderData()
	const { invitationId } = Route.useParams()
	const navigate = useNavigate()
	const [error, setError] = useState<string | null>(null)
	const [pending, setPending] = useState(false)

	if (invitation.state === 'other_email') {
		return (
			<AuthShell title={m.invite_title()}>
				<p>{m.invitation_other_email({ email: invitation.email })}</p>
			</AuthShell>
		)
	}
	if (invitation.state !== 'open') {
		return (
			<AuthShell title={m.invite_title()}>
				<p>{m.invitation_expired()}</p>
			</AuthShell>
		)
	}

	async function accept() {
		setError(null)
		setPending(true)
		const result = await authClient.organization.acceptInvitation({ invitationId })
		if (result.error) {
			setPending(false)
			return setError(m.invitation_expired())
		}
		const organizationId = result.data?.invitation.organizationId
		if (organizationId) await authClient.organization.setActive({ organizationId })
		await navigate({ to: '/home' })
	}

	const role = invitation.role ? roleNames[invitation.role]() : ''
	return (
		<AuthShell title={m.invitation_title({ organization: invitation.organizationName })}>
			<p className="mb-4">{m.invitation_body({ inviter: invitation.inviterName, role })}</p>
			<FormError message={error} />
			<Button onClick={accept} disabled={pending}>
				{m.accept_invitation()}
			</Button>
		</AuthShell>
	)
}
