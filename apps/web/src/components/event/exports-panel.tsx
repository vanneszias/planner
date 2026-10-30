import type { ExportKind } from '@app/domain'
import { Button } from '@app/ui/components/button'
import { useCallback, useEffect, useState } from 'react'
import { FormError } from '#/components/auth-shell'
import { actionMessage } from '#/lib/errors'
import { formatStamp } from '#/lib/format'
import { m } from '#/paraglide/messages'
import { exportLinkFn, getExportsFn, requestExportFn } from '#/server/event-day'

type Export = Awaited<ReturnType<typeof getExportsFn>>[number]

const kinds: { kind: ExportKind; label: () => string }[] = [
	{ kind: 'participants', label: m.export_participants },
	{ kind: 'programmes', label: m.export_programmes },
	{ kind: 'attendance', label: m.export_attendance },
]

/**
 * CSV exports (journeys.md, O9). Files are built in the background and kept
 * for 7 days; downloads go through a link that works for 15 minutes.
 */
export function ExportsPanel({ eventId }: { eventId: string }) {
	const [exports, setExports] = useState<Export[]>([])
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const refresh = useCallback(
		async () => setExports(await getExportsFn({ data: eventId })),
		[eventId],
	)

	useEffect(() => {
		refresh()
	}, [refresh])
	// Check again while something is being built.
	const building = exports.some((e) => e.status === 'pending')
	useEffect(() => {
		if (!building) return
		const timer = setInterval(refresh, 2000)
		return () => clearInterval(timer)
	}, [building, refresh])

	async function request(kind: ExportKind) {
		setError(null)
		setBusy(true)
		const result = await requestExportFn({ data: { eventId, kind } })
		setBusy(false)
		if (!result.ok) return setError(actionMessage(result))
		await refresh()
	}

	async function download(id: string) {
		setError(null)
		const result = await exportLinkFn({ data: id })
		if (!result.ok) return setError(actionMessage(result))
		window.location.assign(result.data)
	}

	const label = (kind: ExportKind) => kinds.find((k) => k.kind === kind)?.label() ?? kind

	return (
		<section aria-labelledby="exports" className="flex flex-col gap-3 rounded-xl bg-card p-5">
			<div>
				<h2 id="exports" className="text-lg font-bold">
					{m.exports_title()}
				</h2>
				<p className="text-sm text-muted-foreground">{m.exports_hint()}</p>
			</div>
			<div className="flex flex-wrap gap-2">
				{kinds.map(({ kind, label }) => (
					<Button key={kind} variant="outline" disabled={busy} onClick={() => request(kind)}>
						{label()}
					</Button>
				))}
			</div>
			<FormError message={error} />
			{exports.length > 0 && (
				<ul className="flex flex-col divide-y divide-border" aria-live="polite">
					{exports.map((e) => (
						<li key={e.id} className="flex flex-wrap items-center gap-3 py-2">
							<span className="flex-1">
								<span className="block font-bold">{label(e.kind)}</span>
								<span className="text-sm text-muted-foreground">
									{formatStamp(e.createdAt)}
									{e.rows !== null && ` · ${m.export_rows({ count: String(e.rows) })}`}
								</span>
							</span>
							{e.status === 'ready' ? (
								<Button
									variant="outline"
									aria-label={m.export_download_for({ name: label(e.kind) })}
									onClick={() => download(e.id)}
								>
									{m.export_download()}
								</Button>
							) : (
								<span className="text-sm font-bold">
									{e.status === 'pending' ? m.export_building() : m.export_failed()}
								</span>
							)}
						</li>
					))}
				</ul>
			)}
		</section>
	)
}
