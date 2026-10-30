import {
	type AllocationInput,
	type AllocationResult,
	allocate,
	ENGINE_VERSION,
	inputHash,
} from '@app/allocation'
import { type Db, schema, uuidv7 } from '@app/db'
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { auditStatement } from './audit.ts'
import { type OrganizerContext, requirePermission } from './context.ts'
import { chunk, rowsPerInsert } from './d1-limits.ts'
import { invalid, notFound } from './errors.ts'
import { getEvent } from './events.ts'

/*
 * Draft, review and publish (docs/allocation-mvp.md, "Lifecycle"). Runs are
 * immutable: manual moves are overrides on top, and "Fill all empty places"
 * creates a new run. Inputs and results go to object storage (R2 in
 * production) because they're large and contain names.
 */

/** Where run snapshots live. R2 in production; a Map in tests. */
export type RunStorage = {
	put(key: string, value: unknown): Promise<void>
	get<T>(key: string): Promise<T | null>
}

export type Run = typeof schema.allocationRun.$inferSelect
type Placement = { registrationId: string; sessionId: string }

/** Everything the engine needs, read from D1 at this moment. */
export async function buildAllocationInput(
	db: Db,
	ctx: OrganizerContext,
	eventId: string,
	options: {
		seed: string
		strategy?: AllocationInput['rules']['strategy']
		fill?: 'none' | 'any-open'
	},
): Promise<AllocationInput> {
	const event = await getEvent(db, ctx, eventId)
	const [registrations, sessions, eligibility, preferences, locked] = await Promise.all([
		db
			.select({
				id: schema.registration.id,
				ageGroupId: schema.registration.ageGroupId,
				submittedAt: schema.registration.preferencesSubmittedAt,
			})
			.from(schema.registration)
			.where(
				and(eq(schema.registration.eventId, eventId), eq(schema.registration.status, 'active')),
			),
		db
			.select({
				id: schema.eventSession.id,
				workshopId: schema.eventSession.workshopId,
				startsAt: schema.eventSession.startsAt,
				endsAt: schema.eventSession.endsAt,
				capacity: schema.eventSession.capacity,
			})
			.from(schema.eventSession)
			.where(
				and(eq(schema.eventSession.eventId, eventId), eq(schema.eventSession.status, 'scheduled')),
			),
		db
			.select({
				workshopId: schema.workshopAgeGroup.workshopId,
				ageGroupId: schema.workshopAgeGroup.ageGroupId,
			})
			.from(schema.workshopAgeGroup)
			.innerJoin(schema.workshop, eq(schema.workshop.id, schema.workshopAgeGroup.workshopId))
			.where(eq(schema.workshop.eventId, eventId)),
		db
			.select({
				registrationId: schema.preference.registrationId,
				workshopId: schema.preference.workshopId,
			})
			.from(schema.preference)
			.where(eq(schema.preference.eventId, eventId))
			.orderBy(asc(schema.preference.registrationId), asc(schema.preference.rank)),
		db
			.select({
				participantId: schema.assignment.registrationId,
				sessionId: schema.assignment.sessionId,
			})
			.from(schema.assignment)
			.where(and(eq(schema.assignment.eventId, eventId), eq(schema.assignment.locked, true))),
	])

	const groupsOf = new Map<string, string[]>()
	for (const e of eligibility)
		groupsOf.set(e.workshopId, [...(groupsOf.get(e.workshopId) ?? []), e.ageGroupId])
	const prefs: Record<string, string[]> = {}
	for (const p of preferences)
		prefs[p.registrationId] = [...(prefs[p.registrationId] ?? []), p.workshopId]

	return {
		participants: registrations.map((r) => ({
			id: r.id,
			ageGroupId: r.ageGroupId,
			submittedAt: r.submittedAt?.getTime() ?? null,
		})),
		sessions: sessions.map((s) => ({
			id: s.id,
			workshopId: s.workshopId,
			startsAt: s.startsAt.getTime(),
			endsAt: s.endsAt.getTime(),
			capacity: s.capacity,
			ageGroupIds: groupsOf.get(s.workshopId) ?? [],
		})),
		preferences: prefs,
		locked,
		rules: {
			sessionsPerParticipant: event.sessionsPerParticipant,
			strategy: options.strategy ?? event.allocationStrategy,
			seed: options.seed,
			fillUnassigned: options.fill ?? event.fillUnassigned,
		},
	}
}

async function storeRun(
	db: Db,
	storage: RunStorage,
	ctx: OrganizerContext,
	eventId: string,
	input: AllocationInput,
	parent: { id: string; traces: AllocationResult['traces'] } | null,
): Promise<Run> {
	const result = allocate(input)
	// Locked places get no trace, so a derived run keeps the parent's story and adds its own.
	if (parent) {
		for (const [id, entries] of Object.entries(parent.traces)) {
			result.traces[id] = [...entries, ...(result.traces[id] ?? [])]
		}
	}
	const id = uuidv7()
	const inputKey = `runs/${eventId}/${id}/input.json`
	const resultKey = `runs/${eventId}/${id}/result.json`
	await Promise.all([storage.put(inputKey, input), storage.put(resultKey, result)])

	// A new draft replaces earlier drafts; the published run stays until a new publish.
	await db
		.update(schema.allocationRun)
		.set({ status: 'superseded' })
		.where(and(eq(schema.allocationRun.eventId, eventId), eq(schema.allocationRun.status, 'draft')))
	const [run] = await db
		.insert(schema.allocationRun)
		.values({
			id,
			organizationId: ctx.organizationId,
			eventId,
			strategy: input.rules.strategy,
			fillUnassigned: input.rules.fillUnassigned,
			seed: input.rules.seed,
			engineVersion: ENGINE_VERSION,
			inputHash: await inputHash(input),
			inputKey,
			resultKey,
			metrics: result.metrics as unknown as Record<string, unknown>,
			parentRunId: parent?.id ?? null,
			createdBy: ctx.userId,
		})
		.returning()
	await auditStatement(db, ctx, {
		action: 'allocation.draft',
		subjectType: 'allocation_run',
		subjectId: id,
		eventId,
	})
	return run as Run
}

/** Runs the engine on the current data and stores a draft (O6 step 2). */
export async function createDraftRun(
	db: Db,
	storage: RunStorage,
	ctx: OrganizerContext,
	eventId: string,
	options: { strategy?: AllocationInput['rules']['strategy']; seed?: string } = {},
): Promise<Run> {
	requirePermission(ctx, { event: ['allocate'] })
	const input = await buildAllocationInput(db, ctx, eventId, {
		seed: options.seed ?? uuidv7(),
		strategy: options.strategy,
	})
	return storeRun(db, storage, ctx, eventId, input, null)
}

async function getRun(db: Db, ctx: OrganizerContext, runId: string): Promise<Run> {
	const [run] = await db
		.select()
		.from(schema.allocationRun)
		.where(
			and(
				eq(schema.allocationRun.id, runId),
				eq(schema.allocationRun.organizationId, ctx.organizationId),
			),
		)
		.limit(1)
	if (!run) throw notFound('Allocation run')
	return run
}

/** The run's placements after the organizer's manual moves, in order. */
async function effectivePlacements(
	db: Db,
	run: Run,
	result: AllocationResult,
): Promise<Placement[]> {
	let placements: Placement[] = result.assignments.map((a) => ({
		registrationId: a.participantId,
		sessionId: a.sessionId,
	}))
	const overrides = await db
		.select()
		.from(schema.allocationOverride)
		.where(eq(schema.allocationOverride.runId, run.id))
		.orderBy(asc(schema.allocationOverride.createdAt), asc(schema.allocationOverride.id))
	for (const o of overrides) {
		if (o.fromSessionId) {
			placements = placements.filter(
				(p) => !(p.registrationId === o.registrationId && p.sessionId === o.fromSessionId),
			)
		}
		if (o.toSessionId)
			placements.push({ registrationId: o.registrationId, sessionId: o.toSessionId })
	}
	return placements
}

async function loadRun(db: Db, storage: RunStorage, run: Run) {
	const [input, result] = await Promise.all([
		storage.get<AllocationInput>(run.inputKey),
		storage.get<AllocationResult>(run.resultKey),
	])
	if (!input || !result) throw notFound('Allocation snapshot')
	return { input, result, placements: await effectivePlacements(db, run, result) }
}

export type ReviewPerson = {
	registrationId: string
	ranking: string[]
	sessions: { sessionId: string; workshopId: string; rank: number | null }[]
	empty: number
	trace: AllocationResult['traces'][string]
}

/** Review data (O6 step 3): plain-language metrics and one row per person. */
export async function reviewRun(db: Db, storage: RunStorage, ctx: OrganizerContext, runId: string) {
	requirePermission(ctx, { participant: ['read'] })
	const run = await getRun(db, ctx, runId)
	const { input, result, placements } = await loadRun(db, storage, run)
	const workshopOf = new Map(input.sessions.map((s) => [s.id, s.workshopId]))
	const quota = input.rules.sessionsPerParticipant

	const people: ReviewPerson[] = input.participants.map((p) => {
		const ranking = input.preferences[p.id] ?? []
		const sessions = placements
			.filter((pl) => pl.registrationId === p.id)
			.map((pl) => {
				const workshopId = workshopOf.get(pl.sessionId) ?? ''
				const index = ranking.indexOf(workshopId)
				return { sessionId: pl.sessionId, workshopId, rank: index === -1 ? null : index + 1 }
			})
		return {
			registrationId: p.id,
			ranking,
			sessions,
			empty: Math.max(0, quota - sessions.length),
			trace: result.traces[p.id] ?? [],
		}
	})

	const ranked = people.filter((p) => p.ranking.length > 0)
	const firstChoice = ranked.filter((p) => p.sessions.some((s) => s.rank === 1)).length
	const rankCounts: number[] = []
	for (const p of people)
		for (const s of p.sessions)
			if (s.rank) rankCounts[s.rank - 1] = (rankCounts[s.rank - 1] ?? 0) + 1
	const overrides = await db
		.select({ id: schema.allocationOverride.id })
		.from(schema.allocationOverride)
		.where(eq(schema.allocationOverride.runId, run.id))

	return {
		run,
		people,
		sessionsTaken: Object.fromEntries(
			input.sessions.map((s) => [s.id, placements.filter((pl) => pl.sessionId === s.id).length]),
		),
		metrics: {
			participants: people.length,
			ranked: ranked.length,
			firstChoice,
			rankCounts: Array.from(rankCounts, (c) => c ?? 0),
			emptyPlaces: people.reduce((sum, p) => sum + p.empty, 0),
			peopleWithEmpty: people.filter((p) => p.empty > 0).length,
			manualChanges: overrides.length,
		},
		warnings: result.warnings,
	}
}

/**
 * A manual move on a draft: remove a place, add one, or both. Checked against
 * the same hard constraints as the engine (capacity, overlap, one session per
 * workshop, age group).
 */
export async function moveInRun(
	db: Db,
	storage: RunStorage,
	ctx: OrganizerContext,
	runId: string,
	move: { registrationId: string; fromSessionId?: string; toSessionId?: string },
): Promise<void> {
	requirePermission(ctx, { event: ['allocate'] })
	const run = await getRun(db, ctx, runId)
	if (run.status !== 'draft') throw invalid({ run: 'not_draft' })
	const { input, placements } = await loadRun(db, storage, run)
	const sessionById = new Map(input.sessions.map((s) => [s.id, s]))
	const person = input.participants.find((p) => p.id === move.registrationId)
	if (!person) throw notFound('Registration')

	const mine = placements.filter((p) => p.registrationId === move.registrationId)
	if (move.fromSessionId && !mine.some((p) => p.sessionId === move.fromSessionId)) {
		throw invalid({ fromSessionId: 'not_found' })
	}
	if (move.toSessionId) {
		const target = sessionById.get(move.toSessionId)
		if (!target) throw invalid({ toSessionId: 'not_found' })
		const remaining = mine
			.filter((p) => p.sessionId !== move.fromSessionId)
			.map((p) => sessionById.get(p.sessionId))
			.filter((s) => s !== undefined)
		if (remaining.some((s) => s.workshopId === target.workshopId))
			throw invalid({ toSessionId: 'same_workshop' })
		if (remaining.some((s) => s.startsAt < target.endsAt && target.startsAt < s.endsAt)) {
			throw invalid({ toSessionId: 'overlap' })
		}
		if (
			target.ageGroupIds?.length &&
			!(person.ageGroupId && target.ageGroupIds.includes(person.ageGroupId))
		) {
			throw invalid({ toSessionId: 'not_eligible' })
		}
		const taken = placements.filter((p) => p.sessionId === target.id).length
		if (taken >= target.capacity) throw invalid({ toSessionId: 'full' })
	}
	await db.insert(schema.allocationOverride).values({
		organizationId: ctx.organizationId,
		runId,
		registrationId: move.registrationId,
		fromSessionId: move.fromSessionId ?? null,
		toSessionId: move.toSessionId ?? null,
		createdBy: ctx.userId,
	})
}

/**
 * "Fill all empty places" (D27): a new draft that keeps every current place
 * (including manual moves) and fills the gaps with any open session.
 */
export async function fillEmptyPlaces(
	db: Db,
	storage: RunStorage,
	ctx: OrganizerContext,
	runId: string,
): Promise<Run> {
	requirePermission(ctx, { event: ['allocate'] })
	const run = await getRun(db, ctx, runId)
	const { input, result, placements } = await loadRun(db, storage, run)
	const next: AllocationInput = {
		...input,
		locked: placements.map((p) => ({ participantId: p.registrationId, sessionId: p.sessionId })),
		rules: { ...input.rules, fillUnassigned: 'any-open' },
	}
	return storeRun(db, storage, ctx, run.eventId, next, { id: run.id, traces: result.traces })
}

/** Who would change if this run were published, compared with what participants have now. */
export async function publishPreview(
	db: Db,
	storage: RunStorage,
	ctx: OrganizerContext,
	runId: string,
) {
	requirePermission(ctx, { event: ['publish'] })
	const run = await getRun(db, ctx, runId)
	const { placements } = await loadRun(db, storage, run)
	const current = await db
		.select({
			registrationId: schema.assignment.registrationId,
			sessionId: schema.assignment.sessionId,
		})
		.from(schema.assignment)
		.where(
			and(eq(schema.assignment.eventId, run.eventId), eq(schema.assignment.source, 'allocation')),
		)
	const key = (p: Placement) => `${p.registrationId}:${p.sessionId}`
	const before = new Set(current.map(key))
	const after = new Set(placements.map(key))
	const changed = new Set<string>()
	for (const p of placements) if (!before.has(key(p))) changed.add(p.registrationId)
	for (const p of current) if (!after.has(key(p))) changed.add(p.registrationId)
	return { firstPublish: current.length === 0, peopleChanging: changed.size }
}

/**
 * Publishes a draft (O6 step 5). Runs inside the event's Durable Object so
 * publishes never overlap. Replaces the event's allocation places in one
 * batch; locked organizer placements are untouched.
 */
export async function publishRun(
	db: Db,
	storage: RunStorage,
	ctx: OrganizerContext,
	runId: string,
): Promise<{ registrationIds: string[] }> {
	requirePermission(ctx, { event: ['publish'] })
	const run = await getRun(db, ctx, runId)
	if (run.status !== 'draft') throw invalid({ run: 'not_draft' })
	const { placements } = await loadRun(db, storage, run)
	// Organizer placements stay as they are. "Locked" here means locked in D1,
	// not the run's input: a filled run locks its parent's whole plan.
	const organizerPlaced = await db
		.select({
			registrationId: schema.assignment.registrationId,
			sessionId: schema.assignment.sessionId,
		})
		.from(schema.assignment)
		.where(and(eq(schema.assignment.eventId, run.eventId), eq(schema.assignment.locked, true)))
	const lockedKeys = new Set(organizerPlaced.map((l) => `${l.registrationId}:${l.sessionId}`))
	const toWrite = placements.filter((p) => !lockedKeys.has(`${p.registrationId}:${p.sessionId}`))

	const statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
		db
			.delete(schema.assignment)
			.where(
				and(eq(schema.assignment.eventId, run.eventId), eq(schema.assignment.source, 'allocation')),
			),
		db
			.update(schema.allocationRun)
			.set({ status: 'superseded' })
			.where(
				and(
					eq(schema.allocationRun.eventId, run.eventId),
					eq(schema.allocationRun.status, 'published'),
					ne(schema.allocationRun.id, run.id),
				),
			),
		// Each row binds about 9 values; D1 allows 100 per statement.
		...chunk(toWrite, rowsPerInsert(9)).map((rows) =>
			db.insert(schema.assignment).values(
				rows.map((p) => ({
					organizationId: ctx.organizationId,
					eventId: run.eventId,
					registrationId: p.registrationId,
					sessionId: p.sessionId,
					source: 'allocation' as const,
					runId: run.id,
				})),
			),
		),
		db
			.update(schema.allocationRun)
			.set({ status: 'published', publishedAt: new Date() })
			.where(eq(schema.allocationRun.id, run.id)),
	]
	await db.batch(statements)
	await auditStatement(db, ctx, {
		action: 'allocation.publish',
		subjectType: 'allocation_run',
		subjectId: run.id,
		eventId: run.eventId,
	})
	return { registrationIds: [...new Set(placements.map((p) => p.registrationId))] }
}

/** Runs for an event, newest first, for the allocation screen. */
export async function listRuns(db: Db, ctx: OrganizerContext, eventId: string): Promise<Run[]> {
	await getEvent(db, ctx, eventId)
	return db
		.select()
		.from(schema.allocationRun)
		.where(
			and(
				eq(schema.allocationRun.eventId, eventId),
				inArray(schema.allocationRun.status, ['draft', 'published']),
			),
		)
		.orderBy(desc(schema.allocationRun.createdAt))
}
