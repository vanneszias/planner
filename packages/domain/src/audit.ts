import { type Db, schema } from '@app/db'
import type { OrganizerContext } from './context.ts'

/** Records an organizer action. `data` holds IDs and field names only, never personal data. */
export function auditStatement(
	db: Db,
	ctx: OrganizerContext,
	entry: {
		action: string
		subjectType: string
		subjectId: string
		eventId?: string
		data?: Record<string, unknown>
	},
) {
	return db.insert(schema.auditLog).values({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		actorKind: 'user',
		...entry,
	})
}
