import {
	Marker,
	type MarkerColor,
	type MarkerShape,
	markerColors,
	markerShapes,
} from '@app/ui/components/marker'
import { cn } from 'cn'
import { m } from '#/paraglide/messages'

/**
 * Pick a workshop's marker from the fixed set (design-system.md: never a
 * free-form colour). Two radio groups, previewed with the current pairing.
 */
export function MarkerPicker({
	color,
	shape,
	onChange,
}: {
	color: MarkerColor
	shape: MarkerShape
	onChange: (value: { markerColor: MarkerColor; markerShape: MarkerShape }) => void
}) {
	return (
		<fieldset className="flex flex-col gap-3">
			<legend className="mb-1 font-bold">{m.marker_label()}</legend>
			<p className="-mt-1 text-sm text-muted-foreground">{m.marker_hint()}</p>
			<Swatches
				legend={m.marker_colour()}
				name="marker-colour"
				options={markerColors}
				value={color}
				onChange={(next) => onChange({ markerColor: next, markerShape: shape })}
				render={(option) => <Marker color={option} shape="circle" className="size-6" />}
			/>
			<Swatches
				legend={m.marker_shape()}
				name="marker-shape"
				options={markerShapes}
				value={shape}
				onChange={(next) => onChange({ markerColor: color, markerShape: next })}
				render={(option) => <Marker color={color} shape={option} className="size-6" />}
			/>
		</fieldset>
	)
}

function Swatches<T extends string>({
	legend,
	name,
	options,
	value,
	onChange,
	render,
}: {
	legend: string
	name: string
	options: T[]
	value: T
	onChange: (value: T) => void
	render: (option: T) => React.ReactNode
}) {
	return (
		<fieldset className="grid grid-cols-[4rem_1fr] items-center gap-x-3">
			<legend className="contents">
				<span className="text-sm font-bold text-muted-foreground">{legend}</span>
			</legend>
			<span className="grid grid-cols-8 gap-1 max-[420px]:grid-cols-4">
				{options.map((option) => (
					<label
						key={option}
						title={option}
						className={cn(
							'grid aspect-square w-full max-w-10 cursor-pointer place-items-center rounded-lg border has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
							option === value
								? 'border-primary bg-tint-success shadow-[inset_0_0_0_1px_var(--kelp)]'
								: 'border-transparent hover:bg-accent',
						)}
					>
						<input
							type="radio"
							name={name}
							value={option}
							checked={option === value}
							onChange={() => onChange(option)}
							className="sr-only"
							aria-label={option}
						/>
						{render(option)}
					</label>
				))}
			</span>
		</fieldset>
	)
}
