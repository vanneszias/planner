import { describe, expect, it } from 'vitest'
import { fromCsv, programmeCsv } from '../cli/concierge.ts'
import { csvCell, parseCsv } from '../cli/csv.ts'
import { allocate } from '../src/index.ts'

const options = {
	sessionsPerParticipant: 1,
	strategy: 'take-turns' as const,
	fillUnassigned: 'none' as const,
	seed: 'test',
}

describe('csv', () => {
	it('reads quoted fields and semicolon exports', () => {
		expect(parseCsv('Name;Choice 1\n"De Smet; Jens";Klimmen\r\n')).toEqual([
			{ name: 'De Smet; Jens', 'choice 1': 'Klimmen' },
		])
		expect(parseCsv('a,b\n"say ""hi""",2\n')).toEqual([{ a: 'say "hi"', b: '2' }])
		expect(parseCsv('\uFEFFname\nNoor\n')).toEqual([{ name: 'Noor' }])
	})

	it('neutralises spreadsheet formulas in output', () => {
		expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
		expect(csvCell('+32 470')).toBe("'+32 470")
		expect(csvCell('Noor')).toBe('Noor')
	})
})

describe('concierge', () => {
	const sessions =
		'workshop,date,start,end,capacity\nKlimmen,2027-07-12,10:00,11:15,1\nZeefdruk,2027-07-12,10:00,11:15,5\n'

	it('matches workshop names case-insensitively and writes programmes', () => {
		const data = fromCsv(
			sessions,
			'name,choice 1,choice 2\nNoor,klimmen,ZEEFDRUK\nLars,Klimmen,Zeefdruk\n',
			options,
		)
		expect(data.problems).toEqual([])
		const csv = programmeCsv(data, allocate(data.input))
		expect(csv.split('\n')[0]).toBe('name,session 1,when 1,room 1,was 1,empty slots')
		expect(csv).toContain('choice 1')
		expect(csv).toContain('choice 2')
	})

	it('lists problems instead of guessing', () => {
		const data = fromCsv(
			`${sessions}Broken,2027-07-12,10am,11:00,5\n`,
			'name,choice 1\nNoor,Kayak\n,Klimmen\n',
			options,
		)
		expect(data.problems).toEqual([
			'sessions.csv line 4: needs workshop, date (YYYY-MM-DD), start and end (HH:MM)',
			'participants.csv line 2: "Kayak" is not a workshop in sessions.csv',
			'participants.csv line 3: missing name',
		])
	})
})
