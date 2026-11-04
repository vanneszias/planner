import { cn } from 'cn'

export type MarkerColor =
	| 'tomato'
	| 'sun'
	| 'grass'
	| 'sea'
	| 'grape'
	| 'bubblegum'
	| 'sky'
	| 'moss'
export type MarkerShape =
	| 'circle'
	| 'triangle'
	| 'square'
	| 'diamond'
	| 'star'
	| 'hexagon'
	| 'plus'
	| 'moon'

const fills: Record<MarkerColor, string> = {
	tomato: 'var(--marker-tomato)',
	sun: 'var(--marker-sun)',
	grass: 'var(--marker-grass)',
	sea: 'var(--marker-sea)',
	grape: 'var(--marker-grape)',
	bubblegum: 'var(--marker-bubblegum)',
	sky: 'var(--marker-sky)',
	moss: 'var(--marker-moss)',
}

const shapes: Record<MarkerShape, React.ReactNode> = {
	circle: <circle cx="10" cy="10" r="8" />,
	triangle: <polygon points="10,2 18.5,17 1.5,17" />,
	square: <rect x="3" y="3" width="14" height="14" rx="1.5" />,
	diamond: <polygon points="10,1.5 18.5,10 10,18.5 1.5,10" />,
	star: (
		<polygon points="10,1.5 12.6,7.3 18.8,7.6 14,11.6 15.6,17.8 10,14.4 4.4,17.8 6,11.6 1.2,7.6 7.4,7.3" />
	),
	hexagon: <polygon points="10,1.5 17.4,5.75 17.4,14.25 10,18.5 2.6,14.25 2.6,5.75" />,
	plus: <path d="M7.5 2.5h5v5h5v5h-5v5h-5v-5h-5v-5h5z" />,
	moon: <path d="M2 9a8 8 0 0 0 16 0z" />,
}

/**
 * A workshop's marker (design-system.md): shape carries the meaning, colour
 * reinforces it. Decorative: the workshop name next to it is the label. The
 * ink outline is what meets the 3:1 non-text contrast requirement.
 */
export function Marker({
	color,
	shape,
	className,
}: {
	color: MarkerColor
	shape: MarkerShape
	className?: string
}) {
	return (
		<svg
			viewBox="0 0 20 20"
			aria-hidden="true"
			focusable="false"
			className={cn('size-5 shrink-0', className)}
			fill={fills[color]}
			stroke="var(--ink)"
			strokeWidth={1.5}
			strokeLinejoin="round"
		>
			{shapes[shape]}
		</svg>
	)
}

/** The fixed marker set, in the default assignment order. */
export const markerColors = Object.keys(fills) as MarkerColor[]
export const markerShapes = Object.keys(shapes) as MarkerShape[]
