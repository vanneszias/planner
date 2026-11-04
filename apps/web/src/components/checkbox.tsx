/** A native checkbox with a large touch target. */
export function Checkbox({
	id,
	label,
	checked,
	onChange,
}: {
	id: string
	label: string
	checked: boolean
	onChange: (checked: boolean) => void
}) {
	return (
		<label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3">
			<input
				id={id}
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
				className="size-5 shrink-0 accent-[var(--kelp)]"
			/>
			{label}
		</label>
	)
}
