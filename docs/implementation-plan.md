# Implementation plan

How we get from the planning docs to the pilot. Milestones come from
[mvp-and-roadmap.md](mvp-and-roadmap.md); this file breaks them into work in
build order and records tooling choices. Tick items as they land.

## Tooling

| Concern         | Choice                                                                    | Why                                                                                                             |
| --------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Package manager | pnpm workspaces                                                           | Decided (A1); no Turborepo until builds are slow                                                                |
| Language        | TypeScript, strict                                                        |                                                                                                                 |
| Lint and format | Biome (single quotes, no semicolons, tabs, 100 columns)                   | One fast tool instead of ESLint plus Prettier                                                                   |
| Tests           | Vitest 5; `@cloudflare/vitest-plugin` for Worker and Durable Object tests | Runs tests inside the Workers runtime (replaces `@cloudflare/vitest-pool-workers`)                              |
| Web framework   | TanStack Start on Workers via `@cloudflare/vite-plugin`                   | Per the [Cloudflare guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/) |
| Database        | D1 with Drizzle ORM and drizzle-kit migrations                            | A3                                                                                                              |
| Auth            | Better Auth 1.7 with the Drizzle adapter                                  | A6                                                                                                              |
| UI              | Tailwind CSS v4, shadcn/ui (components owned in `packages/ui`)            | Design system doc                                                                                               |
| i18n            | Paraglide JS 2, cookie then `Accept-Language`, no locale in URLs          | Small bundles, SSR-safe; event links are shared across languages                                                |
| Local runtime   | Wrangler / Miniflare through the Vite plugin                              | No Cloudflare account needed locally                                                                            |

## Repository layout

Package names use a neutral `@app/*` scope and Workers an `event-*` prefix, so
nothing in code or infrastructure carries the working name.

```
apps/
  web/            event-web: TanStack Start (pages, server functions, auth)
  api/            event-api: external endpoints (feeds, exports)
  jobs/           event-jobs: queue consumers, cron
  coordinator/    event-coordinator: EventCoordinator Durable Object
packages/
  config/         shared tsconfig, test helpers
  brand/          product name, metadata, email branding (the only place "Planner" appears)
  platform/       Cloudflare adapters shared by Workers (coordinator lookup)
  db/             Drizzle schema, migrations, tenant-scoped helpers
  auth/           Better Auth config, roles, browser client
  ui/             design tokens, shadcn/ui components, product components
  domain/         domain logic, no Cloudflare imports (M1)
  allocation/     pure allocation engine (M2)
```

## Running it

```sh
pnpm install
cp apps/web/.dev.vars.example apps/web/.dev.vars   # add a secret: openssl rand -base64 32
pnpm --filter @app/db migrate:local
pnpm dev                                            # http://localhost:3000, all four Workers
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @app/web seed you@example.com   # demo event for a local account
```

Sign-in emails print to the dev server console locally.

## M0: Foundations

Exit: all four Workers run together locally and deploy to preview and
production; sign-in works with all four methods; UI renders in English and Dutch.

### Local

- [x] **Workspace:** root `package.json`, `pnpm-workspace.yaml`, shared
  tsconfig, Biome, Vitest, `.gitignore`, `.nvmrc`.
- [x] **`apps/web`:** TanStack Start app with the Cloudflare Vite plugin,
  `wrangler.jsonc`, `/health` checking D1 and the coordinator.
- [x] **`apps/coordinator`:** `EventCoordinator` Durable Object skeleton (RPC
  stub, broadcast, hibernatable WebSocket accept), with tests.
- [x] **`apps/jobs`:** queue consumer and `scheduled` handler stubs.
- [x] **`apps/api`:** `fetch` handler with `/health`, with tests.
- [x] **Multi-Worker dev:** `pnpm dev` runs `web` with the other three as
  auxiliary Workers; the cross-Worker Durable Object binding works locally.
- [x] **`packages/db`:** Drizzle config, Better Auth tables (including
  organization and rate limiting); first migration applied locally and remotely.
- [x] **Better Auth in `web`:** magic link, email and password (breached-password
  check, 10 characters minimum), passkeys, Google behind env vars, organization
  plugin with `owner`, `editor`, `viewer`. Emails print to the console locally.
- [x] **`packages/brand`.**
- [x] **Design tokens:** Tailwind v4 theme from `design-system.md`, self-hosted
  fonts, shadcn/ui in `packages/ui` with 44 px controls.
- [x] **i18n:** English and Dutch, locale detection, `lang` attribute.
- [x] **Sign-in, sign-up and a placeholder home** in the design direction.

### Cloudflare and Git remote

- [x] Production resources in the `eu` jurisdiction: D1 `event-db`, R2
  `event-files`, Queues `event-jobs` and `event-jobs-dlq` (all verified).
- [x] Production deploy: `https://event-web.zias.workers.dev`,
  `https://event-api.zias.workers.dev`; `coordinator` and `jobs` have no public URL.
- [x] **Previews use per-version preview URLs** (decision 2026-10-30), not a
  separate environment: pull requests upload a `web` version with alias
  `pr-<number>`. Previews share the production D1, R2 and queues, so
  **migrations must be additive** (add, deploy code that handles both, then
  remove) and preview testing must not create real participant data.
- [x] Private GitHub repository `vanneszias/planner`, default branch `main`.
- [x] CI workflow (`.github/workflows/ci.yml`): checks on every PR and push to
  `main`; preview upload on PRs; migrations and ordered deploy on `main`.
- [ ] `CLOUDFLARE_API_TOKEN` GitHub secret (owner creates the token: "Edit
  Cloudflare Workers" template plus D1, Queues and Workers R2 Storage edit).
  Preview and deploy jobs fail until it exists.
- [ ] Email Service sending domain with SPF, DKIM, DMARC; verify its EU processing.
  Until then, deployed emails are queued and dropped (magic links don't work
  deployed; password sign-in does).
- [ ] Google OAuth client.

### Learned in M0

- **Local dev can't apply Durable Object jurisdictions** ("not implemented in
  workerd"). `COORDINATOR_JURISDICTION` is `"eu"` in every `wrangler.jsonc` and
  cleared only by `apps/web/vite.config.ts` during `vite dev`. All lookups go
  through `coordinatorFor()` in `packages/platform`. Verified in production.
- **TanStack Start's `server-entry` ignores `src/server.ts`**, so
  `apps/web/wrangler.jsonc` points `main` at `./src/server.ts` (needed for the
  Paraglide middleware).
- **Workers that bind to another Worker's Durable Object** need that Worker in
  tests; `packages/config/vitest/coordinator-stub.ts` provides a stub.
- **`wrangler types` needs both configs** (`-c wrangler.jsonc -c
  ../coordinator/wrangler.jsonc`) to type the Durable Object binding, and
  `--strict-vars=false` so vars aren't typed as their deployed literal.
- **shadcn `dark:` styles follow the OS setting** by default; tied to a `.dark`
  class until dark mode exists.

## M1: Organizer setup

Exit: an organizer creates an organization, invites an editor, builds an event
with 20 workshops and 60 sessions, and publishes its page.

- [x] **Schema:** `event`, `age_group`, `location`, `workshop`,
  `workshop_age_group`, `event_session`, `slug_redirect`, `audit_log`
  (migration `0001`, applied locally; remote on next deploy).
- [x] **`packages/domain`:** organizer context, role checks, tenant-scoped
  events, workshops and sessions, public event read, slugs, timezone
  conversion, audit entries. Field errors are codes the UI translates.
- [x] **Tenant isolation suite** (`packages/domain/test/tenant-isolation.test.ts`):
  a second organization tries every read and write; verified it fails when the
  organization filter is removed. 19 domain tests in total.
- [x] **Personal organization on sign-up** (journey O1), via a Better Auth hook.
- [x] **Screens:** events dashboard, guided creation (4 steps), event overview
  with checklist and publish, workshops editor with markers, schedule editor
  (several times at once, rooms reused by name, room clashes flagged), public
  event page at `/{org}/{event}`, 404 page. English and Dutch.
- [x] Another organization's event URL shows the 404 page.
- [x] Event settings: description, dates, content language, mode, booking window
  (stored as UTC), and D7–D10 options behind "More options".
- [x] Edit an existing session (time, room, places).
- [x] Team (O3): owners invite owners, editors or viewers; invitees sign in or
  sign up and return to the invitation; organization switcher in the header.
  Reserved slugs are also refused when created through the auth API.
- [x] Rename event and organization addresses; old paths answer 301 to the new
  ones (organization renames cover every event path under them).
- [x] Age groups per event and workshop eligibility; shown on the public page.
- [x] Exit-criterion check with `pnpm --filter @app/web seed <email>`: 20
  workshops and 60 sessions seeded in about 0.6 s; organizer pages answer in
  45–60 ms and the public page is about 52 KB locally; no false room clashes.
- [ ] Long schedules are one long list on phones; consider a workshop filter
  or compact view once real organizers try it.

### Learned in M1

- **Better Auth owns a `session` table**, so workshop sessions are
  `event_session` / `eventSession`.
- **`@cloudflare/vitest-plugin` sometimes logs "Expected global Vitest state"**
  during teardown. Tests still pass; running packages in parallel once turned it
  into a failure, so the root `pnpm test` runs packages one at a time.
- **D1 enforces foreign keys** (cascade verified in tests).
- **Node runs scripts as TypeScript only for erasable syntax** (no parameter
  properties, enums or namespaces). `erasableSyntaxOnly` in the shared tsconfig
  catches it at typecheck.

## M2: Allocation engine

Exit: `packages/allocation` passes property tests and the benchmark, and is
usable from a script for concierge runs.

- [x] **Engine** (`allocate()`): pure TypeScript, no Cloudflare imports. Snake
  draft with "Take turns" (seeded random order) and "Early birds first"
  (submission time, seeded tie-break); session choice keeps other ranked
  workshops possible, then the emptiest, then the earliest; locked placements;
  age-group eligibility; optional fill of empty slots (D10); per-participant
  traces as codes that never mention others (D9); metrics; warnings.
- [x] **Deterministic:** same input, seed and `ENGINE_VERSION` give the same
  result, whatever the order of the input arrays. `inputHash()` (SHA-256 of
  a canonical form) identifies the snapshot.
- [x] **Tests:** 22, including six property tests over 400 random events each
  (capacity, no overlaps, no duplicate workshops, eligibility, rankings,
  quotas, locks kept, determinism, no skipped choice that would have fit).
  Breaking the capacity or overlap check makes them fail.
- [x] **Benchmark** at all three sizes, in Node and a temporary deployed
  Worker: results and numbers in [allocation-mvp.md](allocation-mvp.md).
  Worst case 2.8 s CPU (10,000 participants, filling on), far under the 30 s
  default.
- [x] **Concierge CLI** (`pnpm --filter @app/allocation concierge`): organizer
  spreadsheets in, programme and roster CSVs out, locally.
- [x] Default for empty slots decided: leave empty, with "Fill all empty places"
  on the M4 review screen (D27).
- [ ] Swap pass: after the M4 review screen (D28).

## M3: Registration and booking

Exit: adults self-register, organizers import minors, participants book with
live seat counts and waitlists, and the concurrency test passes.

### M3a: participants

- [x] Schema: `registration`, `assignment`, `waitlist_entry`, `email_delivery` (migration `0002`).
- [x] Tokens: 128-bit private link token and 6-character short code per
  registration, stored as SHA-256 hashes; link exchanged for an `HttpOnly`
  cookie, then redirect to the clean URL (security-privacy.md).
- [x] Domain: register (adult self-registration, D23), participant context,
  book, cancel (change cut-off, D22), waitlist join and promotion. Guarded
  insert enforces capacity, overlap and the per-person limit in one statement.
- [x] EventCoordinator: every booking write for an event goes through its
  Durable Object; broadcasts seat counts to connected browsers (A5).
- [x] Concurrency test: hundreds of parallel bookings on one session, through
  the Durable Object and straight against D1; never overbooked.
- [x] Public event page: register, book, cancel, waitlist, live seats, "My day"
  strip, "I have a code", confirmation email with the private link.
- [x] Turnstile on registration, code entry and "Find my programme" (Cloudflare
  test keys locally; skipped in production until real keys exist).

Tested in the browser: register and book in one step (Dutch confirmation email
with link, code and cancel link), overlaps and per-person count, "My day"
strip, private link swapped for a cookie with a clean URL, code typed in
lower case with a space, wrong code, waitlist and promotion with email, live
seat counts over WebSocket, and "Not you? Cancel this registration" revoking
the link.

### Learned in M3a

- **Durable Objects interleave at every await**, D1 calls included, so the
  coordinator chains writes in a promise queue.
- **Values returned over Durable Object RPC are typed with `Disposable`**,
  which TanStack Start won't serialize; annotate them with the domain type.
- **TanStack Router validates search params twice**, the second time with
  the first result, so `validateSearch` must accept its own output.
- **WebSocket close code 1005 is reported, never sent**; echoing it throws.
- **`/vitest-plugin` wants a `main` entry** even for tests that
  only call functions; without it, it logs uncaught service-binding errors.

### M3b: organizer side

- [x] Participant list with filters (age group, no sessions yet, on a waitlist);
  every read is audit-logged (D14). Add a minor by hand (D2).
- [x] CSV import of minors with per-row errors; nothing is imported until every
  row is valid (O4).
- [x] Printable code cards with QR codes; email links to guardians (D24).
  Codes are stored hashed, so printing or emailing issues fresh ones and
  earlier cards stop working; the screen warns before continuing.
- [x] Root error screen with a retry button.
- [ ] Print layout checked only by page count (one A4 page for four cards); the
  hidden app chrome on paper still needs a look in a real print preview.

## M4: Ranking and publishing

Exit: participants rank, organizers run drafts, review, adjust and publish;
emails go out; itineraries update.

- [x] Schema: `preference`, `allocation_run`, `allocation_override`; one
  published run per event (partial unique index).
- [x] Ranking for participants (P2): add, reorder with up and down buttons,
  remove, save; event's rank minimum and limit (D8, D26); times shown or hidden
  (D7); eligible workshops only. First submission time orders "Early birds first".
- [x] Organizers enter rankings for minors who don't (D16 fallback).
- [x] Draft runs: snapshot from D1, `allocate()`, input and result stored in R2,
  metrics in D1. Re-running supersedes older drafts.
- [x] Review screen (O6): metrics in plain words, filters (empty places, no
  top-3 choice), per-person ranking, result and explanation; manual moves
  checked against the same constraints; "Fill all empty places" (D27).
- [x] Publish through the event's Durable Object: one batch replacing
  allocation assignments; a second publish shows who moves first.
- [x] Emails "Your programme is ready", deduplicated per run and person.
- [x] Participant explanations when the event allows them (D9).

### Learned in M4

- D1 binds at most 100 values per statement. Every `IN (...)` list and
  multi-row insert goes through `d1-limits.ts` (`chunk`, `maxInList`,
  `rowsPerInsert`); a 150-person test covers publish, credentials, CSV import
  and email claims. Bulk writes go in one `db.batch()` (one query, all or
  nothing), and bulk emails go to the queue with `sendBatch`.
- Locked placements get no trace from the engine, so a run derived with
  "Fill all empty places" carries its parent's traces forward; otherwise
  participants would see an empty explanation.
- Organizers enter rankings from the Participants table (ranking mode only),
  using the same `RankList` as participants.

## M5 (outline)

| Milestone              | First tasks                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------- |
| M5 Event day and pilot | QR check-in, exports, retention job, audit log, security checklist, accessibility audit |

## Setup decisions (2026-10-29)

- **Cloudflare:** use the owner's logged-in Wrangler session to create EU
  resources and deploy previews.
- **Code and CI:** GitHub, with GitHub Actions for checks, migrations and
  `wrangler deploy` of all four Workers. Repo creation confirmed separately.
- **Domain:** none yet; `*.workers.dev` for previews and the pilot setup.
  Passkeys registered there won't carry over to a later domain.
- **Google sign-in:** wired behind environment variables; the button shows only
  when credentials exist.
