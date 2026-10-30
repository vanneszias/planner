/**
 * Concierge allocation from spreadsheets (D18). Runs locally: participant
 * names never leave this machine.
 *
 *   pnpm --filter @app/allocation concierge <sessions.csv> <participants.csv> [options]
 *     --sessions 3            sessions per participant
 *     --strategy take-turns   or early-birds
 *     --fill none             or any-open
 *     --seed <text>           reuse to reproduce a run; random if omitted
 *     --out <folder>          where to write programme.csv and rosters.csv (default: .)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { allocate, inputHash } from '../src/index.ts'
import { fromCsv, programmeCsv, rostersCsv, summary } from './concierge.ts'

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		sessions: { type: 'string', default: '3' },
		strategy: { type: 'string', default: 'take-turns' },
		fill: { type: 'string', default: 'none' },
		seed: { type: 'string' },
		out: { type: 'string', default: '.' },
	},
})

const [sessionsPath, participantsPath] = positionals
if (!sessionsPath || !participantsPath) {
	console.error(
		'Usage: concierge <sessions.csv> <participants.csv> [--sessions 3] [--strategy take-turns|early-birds] [--fill none|any-open] [--seed text] [--out folder]',
	)
	process.exit(1)
}
if (values.strategy !== 'take-turns' && values.strategy !== 'early-birds')
	throw new Error('--strategy must be take-turns or early-birds')
if (values.fill !== 'none' && values.fill !== 'any-open')
	throw new Error('--fill must be none or any-open')

const data = fromCsv(readFileSync(sessionsPath, 'utf8'), readFileSync(participantsPath, 'utf8'), {
	sessionsPerParticipant: Number(values.sessions),
	strategy: values.strategy,
	fillUnassigned: values.fill,
	seed: values.seed ?? crypto.randomUUID(),
})

if (data.problems.length) {
	console.error(`Fix these first:\n- ${data.problems.join('\n- ')}`)
	process.exit(1)
}

const result = allocate(data.input)
writeFileSync(join(values.out, 'programme.csv'), programmeCsv(data, result))
writeFileSync(join(values.out, 'rosters.csv'), rostersCsv(data, result))
console.log(summary(data, result))
console.log(`Input hash: ${await inputHash(data.input)}`)
console.log(`Wrote ${join(values.out, 'programme.csv')} and ${join(values.out, 'rosters.csv')}`)
