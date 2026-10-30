# Architecture

Decisions A1 to A5 in [decisions.md](decisions.md). All stateful resources use
the `eu` jurisdiction ([eu-data-residency.md](eu-data-residency.md)).

## Workers

```
                 browser ──── HTTPS / WebSocket ────┐
                    │                               │
                    ▼                               │
   ┌──────────── web ─────────────┐                 │
   │ TanStack Start: SSR, server  │                 │
   │ functions, auth, Turnstile   │                 │
   └──┬──────────┬────────────┬───┘                 │
      │ D1 reads │ writes     │ enqueue              │
      ▼          ▼            ▼                      │
     D1 ◄── coordinator ── Queues ──► jobs           │
      ▲     (EventCoordinator DO,     (consumers,    │
      │      one per event) ◄─────────  cron)        │
      │          ▲  WebSocket upgrade ───────────────┘
      │          │
     api ────────┘   calendar feeds, exports, webhooks,
                     later the public API
```

| Worker        | Owns                                                                                               | Bindings                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `web`         | Pages, server functions, auth, organizer and participant UI. Reads D1 directly.                    | D1, R2, coordinator (service binding to the DO namespace), Queues producer, Turnstile secret |
| `api`         | External, token-authenticated endpoints: iCal feeds, exports, webhooks; the public API in Phase 3. | D1, R2, coordinator, Queues producer                                                         |
| `jobs`        | Queue consumers (email, exports), cron (reminders, 90-day retention cleanup).                      | D1, R2, coordinator, Queues consumer                                                         |
| `coordinator` | Hosts the `EventCoordinator` Durable Object class. No public routes.                               | D1                                                                                           |

`web` and `api` don't call each other. Both import the same domain packages,
so a booking made through the UI and one made through a future API run the
same code and go through the same Durable Object.

## EventCoordinator (one Durable Object per event)

Addressed with `env.EVENT_COORDINATOR.jurisdiction("eu").idFromName(eventId)`.
Event IDs are opaque, never names: DO IDs are logged outside the jurisdiction.

**Owns, serialised per event:**

- Bookings and cancellations (FCFS mode)
- Waitlist promotion when a seat frees up
- Allocation publishing (one publish at a time; rejects a publish while bookings are open)
- Organizer manual moves on published assignments

**Does not own:** reads, event editing, registration profile data, allocation
_computation_ (drafts run in `web`, only publishing goes through the DO).

Each write runs the guarded SQL from [decisions.md](decisions.md) against D1,
then broadcasts the change. D1 is the only source of truth: if the object is
evicted, nothing is lost, and it rebuilds seat counts from D1 on first use.

**Live updates:** browsers on an event page open a WebSocket to the object
(routed through `web`). The object uses hibernatable WebSockets so it isn't
billed while connections sit idle. Messages carry seat counts and allocation
status, never personal data. Clients treat the socket as a hint and refetch
through TanStack Query, so a dropped connection only means slightly stale counts.

**Why this is worth it now:** serialising an event's writes in one place makes
waitlist promotion, publish-vs-booking races and live seat counts simple, at
the cost of one more deployable. The guarded SQL keeps D1 safe even if a write
ever bypasses the object.

## Monorepo layout (sketch)

```
apps/
  web/          TanStack Start
  api/
  jobs/
  coordinator/
packages/
  domain/       events, workshops, sessions, registrations, preferences, assignments
  allocation/   pure engine, no Cloudflare imports
  db/           Drizzle schema, migrations, tenant-scoped query helpers
  ui/           shadcn/ui components and design tokens
  brand/        product name, logos, metadata, email branding (rebrandable)
  config/       shared tsconfig, eslint, wrangler helpers
```

## To verify before building

- Cross-Worker Durable Object bindings (`script_name`) and service bindings work
  in local dev with the Cloudflare Vite plugin across four apps.
- Hibernatable WebSocket API and pricing for the expected number of open
  connections per event (200 participants is small).
- Current Worker CPU limits for the allocation benchmark.
- Concurrency test for bookings, with and without the Durable Object.
