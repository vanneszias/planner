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

## M1 to M5 (outline)

| Milestone                   | First tasks                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1 Organizer setup          | Remaining schema (events through sessions), tenant-scoped helpers with the isolation test suite, guided event creation, workshops and sessions editor, public event page |
| M2 Allocation engine        | `packages/allocation` with property tests, snake draft, both strategies, traces, benchmark script for the three sizes                                                    |
| M3 Registration and booking | Registration and tokens, guarded booking SQL, EventCoordinator booking path, waitlist, live seat counts, concurrency test                                                |
| M4 Ranking and publishing   | Ranking UI, draft runs, review screen, publish through the coordinator, email via `jobs`                                                                                 |
| M5 Event day and pilot      | QR check-in, exports, retention job, audit log, security checklist, accessibility audit                                                                                  |

## Setup decisions (2026-10-29)

- **Cloudflare:** use the owner's logged-in Wrangler session to create EU
  resources and deploy previews.
- **Code and CI:** GitHub, with GitHub Actions for checks, migrations and
  `wrangler deploy` of all four Workers. Repo creation confirmed separately.
- **Domain:** none yet; `*.workers.dev` for previews and the pilot setup.
  Passkeys registered there won't carry over to a later domain.
- **Google sign-in:** wired behind environment variables; the button shows only
  when credentials exist.
