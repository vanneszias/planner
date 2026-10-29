# MVP spec and roadmap

Builds on [decisions.md](decisions.md), [architecture.md](architecture.md) and
[allocation-mvp.md](allocation-mvp.md).

## MVP goal

**One real youth or community event runs end to end on the platform**: an
organizer sets it up, participants (including organizer-registered minors) get
a session either by booking or by ranked allocation, everyone has an itinerary,
and organizers check people in on the day.

The MVP is done when a 200-participant pilot event completes with:

- no overbooked session and no lost booking,
- every participant able to find their itinerary without help,
- the organizer able to run setup, allocation and check-in without us in the room,
- participant data deleted on schedule after the event.

## MVP scope

### Platform foundations

- pnpm monorepo, four Workers (`web`, `api`, `jobs`, `coordinator`), preview and
  production environments, all stateful resources in the `eu` jurisdiction.
- Drizzle schema and migrations for D1, run in CI before deploy.
- `brand` package: product name, logos, metadata, email templates (rebrandable).
- English and Dutch UI (D13). Organizer-entered content is shown as written.
- Structured logs with IDs only, no names or emails.
- Audit log of organizer actions on participant data and allocations.

### Accounts and organizations

- **Better Auth** (A6) with magic link, passkeys, email and password, and Google
  sign-in. Turnstile on sign-up and password sign-in.
- Organizations with **Owner, Editor, Viewer** roles (D14); invite collaborators
  by email. A personal organization is created on sign-up.

### Events, workshops, sessions

- Guided event creation: name, dates, location, registration mode (booking or
  ranking), sensible defaults for everything else.
- Workshops: title, description, image (R2), facilitator name, category, age
  groups, location.
- Sessions: workshop, start, end, room, capacity. Bulk "repeat this workshop at
  these times". A list editor plus a read-only day grid; every action is possible
  without drag and drop.
- Public event page (SSR, shareable link and QR code), with logo and accent colour
  per event.
- Per-event settings from D7 to D10 (times while ranking, rank limit,
  explanations, empty slots), all with defaults so most organizers never open them.

### Registration

- Adults self-register: name, email, age group; magic-link return to their
  itinerary.
- Organizers register minors (D2): one at a time or CSV import, minimal fields.
- Every participant has a private link and QR code (unguessable token), which
  also works for minors without email (D16). It opens their booking or ranking
  page and their itinerary, and is the code scanned at check-in.
- Organizers can also enter or CSV-import choices for minors on their behalf (D16).

### Booking mode (FCFS)

- Participants book sessions; capacity, overlap and eligibility enforced by the
  event's Durable Object plus the guarded SQL.
- Waitlist per session with automatic promotion on cancellation.
- Live seat counts over WebSockets (A5).
- Booking window: opens and closes at organizer-set times.

### Ranking mode (allocation)

- Participants rank workshops up to the event's limit, on mobile, with a
  keyboard- and screen-reader-friendly reorder (move up/down buttons, not only drag).
- Organizer runs a draft allocation with "Take turns" or "Early birds first",
  reviews metrics and per-person results, moves people manually, publishes.
- Organizer-locked placements respected (D12).
- Swap pass as a stretch goal (D11).

### Itinerary and communication

- Itinerary view: timeline per day, workshop details, room, changes highlighted.
- Emails via Cloudflare Email Service (A7), sent by the `jobs` Worker: registration confirmation, magic links,
  allocation published, session changed or cancelled. Add-to-calendar via iCal
  feed from `api`.

### Event day

- **Basic QR check-in** (D15): organizers scan a participant's QR code per
  session from a phone browser; manual search as fallback. Needs a connection
  (D17); printed attendance lists cover venues without signal.
- Attendance and session lists: on screen, CSV export, printable.

### Privacy and operations

- 90-day retention for all participants' data (D6, D21): anonymised, with
  attendance statistics kept (D20), via cron in `jobs`.
- Organizer data export and delete per event.
- Privacy notice and organizer DPA templates.
- Concurrency test, allocation benchmark, accessibility audit (WCAG 2.2 AA) before the pilot.

## Explicitly not in the MVP

Paid ticketing, per-time-block hybrid scheduling, satisfaction-maximising
solver, group constraints, reallocation after publishing, public API and
webhooks (the `api` Worker serves feeds and exports only), event discovery,
full custom branding, facilitator portal, feedback forms, analytics dashboards,
SMS and push notifications, native apps, French UI.

## Milestones

Each milestone ends with something deployable to the preview environment.

| # | Milestone | Exit criteria |
|---|---|---|
| M0 | **Foundations** | Four Workers deploy from CI to preview and production; EU D1, R2 and Queues exist; Better Auth sign-in works with all four methods; i18n renders EN and NL. |
| M1 | **Organizer setup** | An organizer creates an organization, invites an editor, builds an event with 20 workshops and 60 sessions, and publishes its page. |
| M2 | **Allocation engine (standalone)** | `packages/allocation` passes property tests (no constraint ever violated, same seed gives the same result) and the benchmark table in allocation-mvp.md. Usable from a script for concierge runs. |
| M3 | **Registration and booking** | Adults self-register, organizers import minors, participants book with live seat counts and waitlists, the concurrency test passes. |
| M4 | **Ranking and publishing** | Participants rank, organizers run drafts, review, adjust and publish; emails go out; itineraries update. |
| M5 | **Event day and pilot readiness** | QR check-in, attendance exports, retention cleanup, audit log, accessibility audit fixed, privacy documents ready. |

M2 sits early on purpose: with the engine runnable from a script, we can run a
real organizer's allocation by hand (experiment 2 below) while M3 and M4 are
still being built.

## Roadmap after the MVP

The original Phase 1 and 2 merge into the MVP because of decision D1.

| Phase | Theme | Contents |
|---|---|---|
| 1 | **MVP** | Everything above, proven on 1 to 3 pilot events. |
| 2 | **Depth for repeat organizers** | Duplicate an event or use templates; per-time-block hybrid; reallocation after publishing; group constraints; satisfaction-maximising solver (benchmarked, Workflow or container if needed); offline-capable check-in; facilitator view; feedback forms; French UI. |
| 3 | **Platform** | Public API and webhooks on the `api` Worker; notification preferences; basic analytics; richer event branding; integrations (calendar, mailing lists). |
| 4 | **Commercialisation and ecosystem** | Pricing live; paid ticketing; event discovery; third-party extensions. |

**Pricing should be decided before Phase 3, not Phase 4.** Pilots are free, but
the pricing model (per event, per participant or subscription) changes what
Phase 2 and 3 optimise for. A willingness-to-pay test during the pilot (experiment 5)
feeds that decision.

## Validation experiments

| # | Experiment | When | What it tells us | Success signal |
|---|---|---|---|---|
| 1 | Interview 6 to 8 organizers of youth and community events; collect their current spreadsheets and forms | Before M1 | How they allocate today, what hurts, whether ranking is wanted | At least half describe manual allocation as a top pain |
| 2 | Concierge allocation: run a real event's allocation with the engine from a script, hand back results | After M2 | Whether the engine's output beats their manual result, and what they change | Organizer accepts the result with few manual moves |
| 3 | Clickable prototype test with 8 to 10 young participants: book vs rank, with and without times | Before M4 UI | Which flow participants complete faster and prefer | Ranking completed in under 2 minutes on a phone |
| 4 | Pilot event (200 participants) | After M5 | The MVP goal above | All MVP done criteria met |
| 5 | Show pilot organizers three price points and models | During pilot | Willingness to pay and preferred model | At least one organizer would pay for their next event |

## Risks

| Risk | Mitigation |
|---|---|
| **MVP scope is large** (both modes, four Workers, live updates, check-in, four sign-in methods) | Milestones are independently shippable; the concierge experiment gives value before the full UI. Cut candidates if needed: Google sign-in, live seat counts, swap pass. |
| Local development across four Workers with cross-Worker Durable Object bindings | Prove it in M0 before building features. |
| Cloudflare Email Service is in public beta; EU processing not confirmed | Verify data location and terms before the pilot; keep sending behind a small interface so another provider can be swapped in. |
| Better Auth with four methods widens the auth surface | Use its built-in rate limiting and Turnstile support; password breach checks; security review before the pilot. Verify D1 setup against current Better Auth docs. |
| Minors' data and GDPR | Minimal fields, 90-day retention, DPA, no personal data in logs or DO IDs, legal review of the privacy notice. |
| TanStack Start moves fast | Pin versions; upgrade deliberately between milestones. |
| WebSocket and Durable Object cost at larger events | Hibernatable WebSockets; measure during the pilot. |
