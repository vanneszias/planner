/**
 * Times the engine at the three sizes from docs/allocation-mvp.md.
 *   pnpm --filter @app/allocation bench
 * Node runs the same V8 engine as Workers, so this is a fair first estimate;
 * the deployed check is in bench/worker.ts.
 */
import { allocate } from '../src/index.ts'
import { generate, sizes } from './generate.ts'

const repeats: Record<string, number> = { target: 30, 'large camp': 5, stress: 3 }

for (const [size, fill] of sizes.flatMap(
	(s) =>
		[
			[s, 'none'],
			[s, 'any-open'],
		] as const,
)) {
	const input = generate(size, 'bench', fill)
	allocate(input) // warm up
	const times: number[] = []
	let result = allocate(input)
	for (let i = 0; i < (repeats[size.name] ?? 3); i++) {
		const started = performance.now()
		result = allocate(input)
		times.push(performance.now() - started)
	}
	times.sort((a, b) => a - b)
	const median = times[Math.floor(times.length / 2)] ?? 0
	const m = result.metrics
	console.log(
		[
			size.name.padEnd(11),
			`fill ${fill.padEnd(8)}`,
			`${String(size.participants).padStart(6)} participants`,
			`${String(input.sessions.length).padStart(5)} sessions`,
			`median ${median.toFixed(1).padStart(7)} ms`,
			`first choice ${(m.firstChoiceShare * 100).toFixed(0)}%`,
			`avg rank ${m.averageRank?.toFixed(2)}`,
			`unfilled ${m.unfilledSlots}/${m.slotsRequested}`,
		].join('  '),
	)
}
console.log(`heap used ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0)} MB`)
