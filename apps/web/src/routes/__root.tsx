import { brand } from '@app/brand'
import { createRootRoute, HeadContent, Scripts } from '@tanstack/react-router'
import type { ReactNode } from 'react'
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
		],
		links: [{ rel: 'stylesheet', href: appCss }],
	}),
	shellComponent: RootDocument,
	notFoundComponent: NotFound,
})

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
