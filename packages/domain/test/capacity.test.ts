import { describe, expect, it } from 'vitest'
import { blockCapacities, peopleCapacity } from '../src/capacity.ts'

const at = (time: string) => new Date(`2026-11-15T${time}:00Z`)
const session = (start: string, end: string, capacity: number, status?: 'cancelled') => ({
	startsAt: at(start),
	endsAt: at(end),
	capacity,
	status,
})

describe('peopleCapacity', () => {
	// The screenshot case: three slots of 70 places, three sessions each.
	const event = [
		...[10, 15, 30, 15].map((c) => session('10:00', '11:00', c)),
		session('12:00', '13:00', 70),
		...[10, 15, 30, 15].map((c) => session('13:00', '14:00', c)),
	]

	it('counts people, not seats', () => {
		expect(blockCapacities(event)).toEqual([70, 70, 70])
		expect(peopleCapacity(event, 3)).toBe(70)
	})

	it('lets people skip blocks when they need fewer sessions', () => {
		expect(peopleCapacity(event, 2)).toBe(105)
		expect(peopleCapacity(event, 1)).toBe(210)
	})

	it('caps the quota at the number of blocks', () => {
		expect(peopleCapacity(event, 5)).toBe(70)
	})

	it('is limited by a small block when everyone needs every block', () => {
		const sessions = [
			session('10:00', '11:00', 100),
			session('11:00', '12:00', 100),
			session('12:00', '13:00', 10),
		]
		expect(peopleCapacity(sessions, 3)).toBe(10)
		expect(peopleCapacity(sessions, 2)).toBe(105)
	})

	it('merges sessions that overlap through each other and skips cancelled ones', () => {
		const sessions = [
			session('10:00', '11:00', 5),
			session('10:30', '11:30', 5),
			session('11:15', '12:00', 5),
			session('12:00', '13:00', 8),
			session('12:00', '13:00', 50, 'cancelled'),
		]
		expect(blockCapacities(sessions)).toEqual([15, 8])
		expect(peopleCapacity(sessions, 2)).toBe(8)
	})

	it('has room for nobody without sessions', () => {
		expect(peopleCapacity([], 3)).toBe(0)
	})
})
