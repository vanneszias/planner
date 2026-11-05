import { brand, brandAssets } from '@app/brand'
import { Button } from '@app/ui/components/button'
import { createRootRoute, HeadContent, Scripts, useRouter } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { defaultShareMeta } from '#/lib/site'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{ title: brand.name },
			{ name: 'description', content: brand.description[getLocale()] },
			{ name: 'theme-color', content: brand.themeColor },
			{ name: 'apple-mobile-web-app-title', content: brand.name },
			...defaultShareMeta(),
		],
		links: [
			{ rel: 'stylesheet', href: appCss },
			{ rel: 'icon', href: brandAssets.faviconIco, sizes: '32x32' },
			{ rel: 'icon', href: brandAssets.favicon, type: 'image/svg+xml' },
			{ rel: 'apple-touch-icon', href: brandAssets.appleTouchIcon },
			{ rel: 'manifest', href: brandAssets.manifest },
		],
	}),
	shellComponent: RootDocument,
	notFoundComponent: NotFound,
	errorComponent: ErrorPage,
})

/** Anything that failed to load: say what to do, offer a retry. */
function ErrorPage() {
	const router = useRouter()
	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-4">
			<h1 className="font-display text-2xl font-semibold">{m.error_page_title()}</h1>
			<p className="text-muted-foreground">{m.error_page_body()}</p>
			<div>
				<Button onClick={() => router.invalidate()}>{m.try_again()}</Button>
			</div>
		</main>
	)
}

/** Unknown paths and unpublished event links: say what to do, don't apologise. */
function NotFound() {
	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-2 px-4">
			<h1 className="font-display text-2xl font-semibold">{m.not_found_title()}</h1>
			<p className="text-muted-foreground">{m.not_found_body()}</p>
		</main>
	)
}

function RootDocument({ children }: { children: ReactNode }) {
	return (
		<html lang={getLocale()}>
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	)
}
