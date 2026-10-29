# Domain model and D1 schema

A design sketch, not migration code. Builds on [decisions.md](decisions.md);
the allocation tables follow [allocation-mvp.md](allocation-mvp.md).

## Entities

```
organization ─┬─ member ── user ─┬─ passkey / account / session   (Better Auth)
              ├─ invitation      │
              └─ event ──────────┼──────────────────────────────┐
                  ├─ age_group   │                              │
                  ├─ location    │ (optional: adults, guardians)│
                  ├─ workshop ── workshop_age_group             │
                  │     └─ session ─┬─ assignment ─┐            │
                  │                 └─ waitlist_entry           │
                  ├─ registration ──┼─ preference  │            │
                  │   (participant) └──────────────┘            │
                  ├─ allocation_run ── allocation_override      │
                  ├─ email_delivery, export_job                 │
                  └─ audit_log ─────────────────────────────────┘
```

| Brief term   | Table          | Notes                                                                           |
| ------------ | -------------- | ------------------------------------------------------------------------------- |
| Workshop     | `workshop`     | What participants want to attend.                                               |
| Session      | `session`      | A scheduled occurrence: time, room, capacity.                                   |
| Registration | `registration` | A participant's enrolment in one event. Not a user: minors have no user.        |
| Preference   | `preference`   | Ranked interest in a workshop.                                                  |
| Assignment   | `assignment`   | A place in a session, from booking, allocation or an organizer. Holds check-in. |
| Itinerary    | _(derived)_    | `assignment` joined to `session`, `workshop`, `location`. Not stored.           |

## Conventions

- **IDs:** random, opaque text (UUIDv7). Never sequential, never derived from
  names, because event IDs also name Durable Objects and DO IDs are logged
  outside the EU.
- **Time:** instants stored as integer milliseconds UTC. `event.timezone` holds
  the IANA zone for display. Dates without time (`starts_on`) as `YYYY-MM-DD` text.
- **Tenancy:** every tenant-owned table carries `organization_id`, even where it
  could be joined, so scoping and deletion never depend on a join. (A3)
- **Names:** no product name in any table, column or enum (rebrandability).
- **Deletes:** organization and event deletes cascade. Participant cancellations
  delete the `assignment` row and write an `audit_log` entry, so capacity is
  always a plain `count(*)`.
- **Secrets:** participant tokens are stored as SHA-256 hashes only.

## Tables

Types: `text`, `int` (integer), `bool` (0/1 integer), `json` (text). `PK` primary
key, `FK` foreign key with cascade delete unless noted, `?` nullable.

### Identity and organizations (Better Auth)

Better Auth owns `user`, `session`, `account`, `verification` and `passkey`, and
its organization plugin owns `organization`, `member` and `invitation`. We
generate their Drizzle schema from Better Auth's CLI and keep it in
`packages/db`, so everything shares one migration history.

- `member.role` uses custom roles `owner`, `editor`, `viewer` (D14).
- `organization.slug` is the first URL segment (D19). It can't collide with
  app routes, so a reserved list (`e`, `api`, `app`, `login`, `signup`,
  `settings`, `admin`, `assets`, …) is checked on create and rename.
- `user` gets no event or participant data; that lives in `registration`.

To verify: custom roles in the organization plugin, and that its tables
work with the Drizzle D1 adapter.

### event

| Column                   | Type    | Notes                                                                                                      |
| ------------------------ | ------- | ---------------------------------------------------------------------------------------------------------- |
| id                       | text PK |                                                                                                            |
| organization_id          | text FK |                                                                                                            |
| slug                     | text    | Unique per organization; public URL is `/{org-slug}/{event-slug}` (D19)                                    |
| name, description        | text    |                                                                                                            |
| timezone                 | text    | IANA, e.g. `Europe/Brussels`                                                                               |
| starts_on, ends_on       | text    |                                                                                                            |
| status                   | text    | `draft`, `published`, `closed`, `archived`                                                                 |
| mode                     | text    | `booking` or `ranking` (D1)                                                                                |
| default_locale           | text    | `en` or `nl` (D13)                                                                                         |
| sessions_per_participant | int     | Slots to fill, e.g. 3                                                                                      |
| rank_limit               | int     | Default 5 (D8)                                                                                             |
| rank_minimum             | int ?   | Null means sessions_per_participant + 1 (D26)                                                              |
| show_times_while_ranking | bool    | Default 1 (D7)                                                                                             |
| show_explanations        | bool    | Default 0 (D9)                                                                                             |
| fill_unassigned          | text    | `none` (default) or `any-open` (D10)                                                                       |
| allocation_strategy      | text    | `take-turns` (default) or `early-birds` (D3)                                                               |
| opens_at, closes_at      | int ?   | Booking or ranking window                                                                                  |
| change_cutoff            | text    | When participants can still cancel or change bookings: `booking-closes` (default) or `session-start` (D22) |
| retention_days           | int     | Default 90, applies to all participants (D6, D21)                                                          |
| data_deleted_at          | int ?   | Set by the retention job                                                                                   |
| logo_key                 | text ?  | R2 key                                                                                                     |
| accent_color             | text ?  |                                                                                                            |
| created_at, updated_at   | int     |                                                                                                            |

Settings are columns, not a JSON blob: there are few of them, they have
defaults, and the engine and the UI both read them.

### slug_redirect

`old_path (PK), organization_id, event_id ?, created_at`.

Renaming an organization or event slug would break links and QR codes already
printed on posters. The old path is recorded here and redirects to the current
one.

### age_group, location

| Table       | Columns                                          |
| ----------- | ------------------------------------------------ |
| `age_group` | id, organization_id, event_id, label, sort_order |
| `location`  | id, organization_id, event_id, name, notes ?     |

### workshop, workshop_age_group

| Column                    | Type    | Notes                                         |
| ------------------------- | ------- | --------------------------------------------- |
| id                        | text PK |                                               |
| organization_id, event_id | text FK |                                               |
| title, description        | text    |                                               |
| image_key                 | text ?  | R2 key                                        |
| facilitator_name          | text ?  | Free text, no facilitator accounts in the MVP |
| category                  | text ?  |                                               |
| sort_order                | int     |                                               |

`workshop_age_group (workshop_id, age_group_id)`, PK on both. No rows means
open to every age group.

### session

| Column                    | Type      | Notes                       |
| ------------------------- | --------- | --------------------------- |
| id                        | text PK   |                             |
| organization_id, event_id | text FK   |                             |
| workshop_id               | text FK   |                             |
| location_id               | text FK ? | Set null on location delete |
| starts_at, ends_at        | int       | Check `ends_at > starts_at` |
| capacity                  | int       | Check `capacity >= 0`       |
| status                    | text      | `scheduled` or `cancelled`  |

### registration (participant)

| Column                    | Type      | Notes                                                   |
| ------------------------- | --------- | ------------------------------------------------------- |
| id                        | text PK   |                                                         |
| organization_id, event_id | text FK   |                                                         |
| user_id                   | text FK ? | Adults who self-register                                |
| managed_by_user_id        | text FK ? | Guardian or adult registering others (D2)               |
| registered_by             | text      | `self`, `guardian`, `organizer`                         |
| display_name              | text      |                                                         |
| email                     | text ?    | Never required for minors                               |
| guardian_email            | text ?    | Minors only, for emailing their private link (D24)      |
| age_group_id              | text FK ? |                                                         |
| is_minor                  | bool      | Drives retention and email rules                        |
| access_token_hash         | text      | Private link and QR, booking, itinerary, check-in (D16) |
| feed_token_hash           | text ?    | iCal feed, separately revocable                         |
| preferences_submitted_at  | int ?     | Ordering for "Early birds first"                        |
| status                    | text      | `active` or `cancelled`                                 |
| created_at                | int       |                                                         |
| anonymised_at             | int ?     | Set by the retention job                                |

The access token and the feed token are separate because calendar URLs end up
in third-party calendar apps; leaking one must not grant booking access.

### preference

`preference (registration_id, workshop_id, rank)`, plus `organization_id`
and `event_id`.

- PK `(registration_id, workshop_id)`
- Unique `(registration_id, rank)`
- `rank` checked between 1 and the event's limit in application code (SQLite
  checks can't reference another table).

### assignment

| Column                    | Type      | Notes                                             |
| ------------------------- | --------- | ------------------------------------------------- |
| id                        | text PK   |                                                   |
| organization_id, event_id | text FK   |                                                   |
| registration_id           | text FK   |                                                   |
| session_id                | text FK   |                                                   |
| source                    | text      | `booking`, `allocation`, `manual`                 |
| run_id                    | text FK ? | Allocation run that produced it                   |
| locked                    | bool      | Organizer placement the allocator must keep (D12) |
| checked_in_at             | int ?     | QR check-in (D15)                                 |
| checked_in_by             | text ?    | user id                                           |
| created_at                | int       |                                                   |

Unique `(registration_id, session_id)`. Inserts use the guarded statement
in [decisions.md](decisions.md).

### waitlist_entry

`id, organization_id, event_id, session_id, registration_id, created_at`.
Unique `(session_id, registration_id)`. Position is `created_at` order;
promotion runs in the event's Durable Object.

### allocation_run, allocation_override

| Column                     | Type    | Notes                                                          |
| -------------------------- | ------- | -------------------------------------------------------------- |
| id                         | text PK |                                                                |
| organization_id, event_id  | text FK |                                                                |
| status                     | text    | `draft`, `published`, `superseded`                             |
| strategy                   | text    |                                                                |
| seed                       | text    |                                                                |
| engine_version             | text    |                                                                |
| input_hash                 | text    | SHA-256 of the canonical input                                 |
| input_key                  | text    | R2 key of the input snapshot (kept out of D1's 2 MB row limit) |
| result_key                 | text    | R2 key of the full result and traces                           |
| metrics                    | json    | Small summary for list views                                   |
| created_by                 | text    | user id                                                        |
| created_at, published_at ? | int     |                                                                |

At most one `published` run per event: partial unique index on
`(event_id) WHERE status = 'published'`.

`allocation_override (id, run_id, registration_id, session_id ?, action, created_by, created_at)`,
`action` is `place`, `remove` or `lock`.

### email_delivery

`id, organization_id, event_id ?, idempotency_key (unique), kind,
registration_id ?, status, provider_message_id ?, attempts, created_at, sent_at ?`.

The `jobs` consumer inserts with the idempotency key before sending (e.g.
`allocation-published:{run_id}:{registration_id}`), so a redelivered queue
message never sends twice. Recipient addresses are not copied here.

### export_job

`id, organization_id, event_id, kind, status, r2_key ?, requested_by, created_at, expires_at`.
Exports land in the EU R2 bucket with a lifecycle rule that matches `expires_at`.

### audit_log

`id, organization_id, event_id ?, actor_user_id ?, actor_kind, action,
subject_type, subject_id, data (json), created_at`.

`actor_kind` is `user`, `participant`, or `system`. `data` holds IDs and changed
field names, never names or emails, so the log survives retention cleanup intact.

## Indexes

| Table          | Index                                                                                                               | Serves                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| event          | unique `(organization_id, slug)`; `(organization_id, starts_on)`                                                    | Public page; organizer event list                |
| workshop       | `(event_id, sort_order)`                                                                                            | Workshop list                                    |
| session        | `(event_id, starts_at)`; `(workshop_id)`                                                                            | Schedule grid; workshop detail                   |
| registration   | unique `(access_token_hash)`; unique `(feed_token_hash)`; `(event_id, status)`; `(user_id)`; `(managed_by_user_id)` | Token lookup; participant lists; "my events"     |
| preference     | PK covers `(registration_id, …)`; `(event_id)`                                                                      | Engine snapshot load                             |
| assignment     | unique `(registration_id, session_id)`; `(session_id)`; `(event_id)`                                                | Capacity count; overlap check; itinerary; roster |
| waitlist_entry | `(session_id, created_at)`                                                                                          | Next in line                                     |
| allocation_run | `(event_id, created_at)`; partial unique published                                                                  | Run history                                      |
| audit_log      | `(organization_id, created_at)`; `(event_id, created_at)`                                                           | Audit views                                      |

At the target size (200 registrations, 600 assignments) every query is small.
These indexes matter for the shared database as organizations accumulate.

## Access paths and tenant scoping

Two contexts, never mixed:

- **Organizer context** `{ userId, organizationId, role }`, from the Better Auth
  session plus membership. `packages/db` exposes query helpers that require this
  context and always add `organization_id = ?`. Writes check the role
  (`viewer` is read-only).
- **Participant context** `{ registrationId, eventId, organizationId }`, from
  either a signed-in user who owns or manages the registration, or a valid
  access token. It can read its own itinerary and preferences and submit
  bookings or rankings, nothing else.

No query helper accepts a bare `event_id` without one of these contexts. This
is the main defence against cross-tenant leaks, so it gets dedicated tests.

## Retention (D6, D20, D21)

Applies to every registration, adult or minor. Adults keep their user account;
only the event data goes.

A daily cron in `jobs` finds events where `ends_on + retention_days` has
passed and `data_deleted_at` is null, then in batches:

1. Revokes tokens and clears `display_name`, `email`, `guardian_email`, `user_id`,
   `managed_by_user_id` on registrations; sets `anonymised_at`.
2. Deletes preferences, waitlist entries and email delivery rows.
3. Keeps assignments and allocation runs (now pointing at anonymous
   registrations) for organizer statistics; deletes R2 input snapshots, which
   contain names.
4. Sets `event.data_deleted_at` and writes an audit entry.

Organizers can trigger the same process early per event.

## Migrations

- Drizzle schema in `packages/db` is the source of truth; `drizzle-kit generate`
  produces SQL, `wrangler d1 migrations apply` runs it locally, in preview and in
  production (CI, before deploying Workers).
- Migrations are additive first: add a column, deploy code that handles both,
  backfill, then remove. All four Workers share the schema, and they don't
  deploy at exactly the same moment.

## To verify

- D1 enforces foreign keys and supports partial unique indexes as SQLite does.
- Better Auth organization plugin with custom roles on D1 via Drizzle.
- Time Travel restore window on the Workers Paid plan, for the backup story.
