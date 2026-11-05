/**
 * The platform mark: three overlapping workshop stickers (circle, triangle,
 * square) with the ink outline every marker carries. Decorative.
 */
export function BrandMark({ className = 'size-7' }: { className?: string }) {
	return (
		<svg viewBox="0 0 28 28" aria-hidden className={className}>
			<g stroke="var(--ink)" strokeWidth="1.5" strokeLinejoin="round">
				<rect x="13" y="12" width="12" height="12" rx="1.5" fill="var(--marker-grass)" />
				<polygon points="16,2.5 23.5,15 8.5,15" fill="var(--marker-sun)" />
				<circle cx="9" cy="17" r="6.25" fill="var(--marker-tomato)" />
			</g>
		</svg>
	)
}
