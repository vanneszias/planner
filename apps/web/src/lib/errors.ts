import { m } from '#/paraglide/messages'
import type { ActionResult } from '#/server/organizer'

/** Turns a domain issue code into a sentence that says how to fix it. */
export function fieldMessage(code: string | undefined): string | null {
	switch (code) {
		case undefined:
			return null
		case 'required':
			return m.field_required()
		case 'too_long':
			return m.field_too_long()
		case 'date':
			return m.field_date()
		case 'date_order':
			return m.field_date_order()
		case 'timezone':
			return m.field_timezone()
		case 'time':
			return m.field_time()
		case 'time_order':
			return m.field_time_order()
		case 'duplicate':
			return m.field_duplicate()
		case 'taken':
			return m.field_taken()
		case 'reserved':
			return m.field_reserved()
		case 'email':
			return m.field_email()
		case 'not_found':
			return m.field_not_found()
		case 'too_many':
			return m.field_too_many()
		case 'outside_event':
			return m.field_outside_event()
		case 'number':
			return m.field_number()
		case 'too_small':
		case 'too_large':
			return m.field_out_of_range()
		default:
			return m.field_required()
	}
}

/** A form-level message for a failed action, when no single field is to blame. */
export function actionMessage(result: Extract<ActionResult<unknown>, { ok: false }>): string {
	if (result.code === 'forbidden') return m.error_forbidden()
	if (result.code === 'not_found') return m.error_not_found()
	return m.error_generic()
}
