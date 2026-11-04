import { cn } from 'cn'

/** Native radio inputs styled as large cards: keyboard and screen-reader behaviour comes free. */
export function RadioCards<T extends string>({
	name,
	legend,
	hideLegend,
	value,
	options,
	onChange,
}: {
	name: string
	legend: string
	hideLegend?: boolean
	value: T
	options: { value: T; title: string; body?: string }[]
	onChange: (value: T) => void
}) {
	return (
		<fieldset className={cn('grid gap-3', options.length === 2 && 'sm:grid-cols-2')}>
			<legend className={cn('mb-2 font-bold', hideLegend && 'sr-only')}>{legend}</legend>
			{options.map((option) => (
				<label
					key={option.value}
					className={cn(
						'flex cursor-pointer gap-3 rounded-lg border bg-card p-4 transition-colors',
						value === option.value
							? 'border-primary shadow-[inset_0_0_0_1px_var(--kelp)]'
							: 'border-input hover:bg-accent/50',
					)}
				>
					<input
						type="radio"
						name={name}
						value={option.value}
						checked={value === option.value}
						onChange={() => onChange(option.value)}
						className="mt-1 size-5 shrink-0 accent-[var(--kelp)]"
					/>
					<span>
						<span className="block font-bold">{option.title}</span>
						{option.body && (
							<span className="block text-sm leading-normal text-muted-foreground">
								{option.body}
							</span>
						)}
					</span>
				</label>
			))}
		</fieldset>
	)
}
