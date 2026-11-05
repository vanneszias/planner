import { Button } from '@app/ui/components/button'
import { Link } from '@tanstack/react-router'
import { m } from '#/paraglide/messages'

export type PassView = {
	registrationId: string
	displayName: string
	forChild: boolean
	qr: string
}

/** The QR code as an image; the link it carries is the participant's private link. */
export function PassImage({ pass, className }: { pass: PassView; className?: string }) {
	return (
		<img
			alt={m.pass_qr_label({ name: pass.displayName })}
			className={className ?? 'size-44 rounded-lg bg-white p-2'}
			src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(pass.qr)}`}
		/>
	)
}

/**
 * Passes for a signed-in participant (D29), or the invitation to make an
 * account when a participant has only the link. Shown above the programme.
 */
export function PassCards({
	passes,
	account,
	hasLink,
	eventPath,
}: {
	passes: PassView[]
	/** Null when signed out. */
	account: { verified: boolean } | null
	/** Whether this browser came in through a private link or code. */
	hasLink: boolean
	/** Where to return after signing up, e.g. /org/event. */
	eventPath: string
}) {
	const needsConfirmation = account !== null && !account.verified
	const offerAccount = hasLink && account === null
	if (passes.length === 0 && !needsConfirmation && !offerAccount) return null
	const signUp = `/sign-up?redirect=${encodeURIComponent(eventPath)}`

	return (
		<section className="flex flex-col gap-4" aria-label={m.pass_title()}>
			{needsConfirmation && (
				<p className="rounded-xl bg-tint-warning p-4 text-sm font-bold">{m.pass_confirm_email()}</p>
			)}
			{passes.map((pass) => (
				<article
					key={pass.registrationId}
					className="flex flex-col items-center gap-3 rounded-xl bg-card p-5 text-center shadow-card sm:flex-row sm:text-left"
				>
					<PassImage pass={pass} />
					<div className="flex flex-col gap-2">
						<p className="font-display text-lg font-semibold">
							{pass.forChild ? m.pass_title_child({ name: pass.displayName }) : m.pass_title()}
						</p>
						<p className="text-sm text-muted-foreground">{m.pass_hint()}</p>
					</div>
				</article>
			))}
			{offerAccount && (
				<article className="flex flex-col gap-3 rounded-xl bg-card p-5 shadow-card">
					<p className="font-display text-lg font-semibold">{m.pass_create_title()}</p>
					<p className="text-sm text-muted-foreground">{m.pass_create_body()}</p>
					<Button asChild className="self-start">
						<Link to={signUp}>{m.pass_create_action()}</Link>
					</Button>
				</article>
			)}
		</section>
	)
}
