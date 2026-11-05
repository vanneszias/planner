import { DurableObject } from 'cloudflare:workers'

// Temporary, step 1 of 2. event-web holds a stray EventCoordinator class
// (migration v1, see wrangler.jsonc), and the live version binds it to itself,
// so Cloudflare refuses to delete it (code 10061). Exporting this stub lets one
// deploy switch the binding to event-coordinator; step 2 removes this file and
// adds the deleted_classes migration. Nothing binds to it, so it never runs.
export class EventCoordinator extends DurableObject {}
