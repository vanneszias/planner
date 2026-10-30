import { useEffect, useRef } from 'react'

type TurnstileApi = {
	render: (
		element: HTMLElement,
		options: {
			sitekey: string
			callback: (token: string) => void
			'expired-callback': () => void
			appearance: 'interaction-only'
		},
	) => string
	remove: (widgetId: string) => void
}

declare global {
	interface Window {
		turnstile?: TurnstileApi
	}
}

let loading: Promise<void> | undefined

function loadScript(): Promise<void> {
	loading ??= new Promise((resolve, reject) => {
		const script = document.createElement('script')
		script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
		script.async = true
		script.onload = () => resolve()
		script.onerror = () => reject(new Error('Turnstile failed to load'))
		document.head.appendChild(script)
	})
	return loading
}

/**
 * Cloudflare Turnstile, shown only if Cloudflare needs an interaction
 * (security-privacy.md). Renders nothing when no site key is configured.
 */
export function Turnstile({
	siteKey,
	onToken,
}: {
	siteKey: string | null
	onToken: (token: string | undefined) => void
}) {
	const container = useRef<HTMLDivElement>(null)
	const callback = useRef(onToken)
	callback.current = onToken

	useEffect(() => {
		if (!siteKey) return
		let widgetId: string | undefined
		let cancelled = false
		loadScript()
			.then(() => {
				if (cancelled || !container.current || !window.turnstile) return
				widgetId = window.turnstile.render(container.current, {
					sitekey: siteKey,
					callback: (token) => callback.current(token),
					'expired-callback': () => callback.current(undefined),
					appearance: 'interaction-only',
				})
			})
			.catch(() => callback.current(undefined))
		return () => {
			cancelled = true
			if (widgetId) window.turnstile?.remove(widgetId)
		}
	}, [siteKey])

	return <div ref={container} />
}
