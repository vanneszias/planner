# Allocation engine: MVP scope

Decisions D1 and D3 put automatic allocation in the MVP, with the organizer
choosing the strategy. This document caps that scope so it stays shippable.

## What the engine is

A pure TypeScript function with no Cloudflare imports:

```ts
allocate(input: AllocationInput): AllocationResult
```

Same input, seed and engine version always produce the same result. Whatever
runs it (a server function today, a Workflow step or container later) only
loads the snapshot and stores the result.

### Input (an immutable snapshot)

- **Participants:** id, eligibility attributes (age group), submission time.
- **Sessions:** id, workshop id, start, end, capacity, eligibility rules.
- **Preferences:** per participant, an ordered list of workshop ids, up to the event's rank limit (default 5).
- **Locked assignments:** organizer-placed or previously published, which the engine must keep.
- **Rules:** sessions to fill per participant (e.g. 3), strategy, seed, and
  `fillUnassigned: 'none' | 'any-open'` (default `none`: leave empty and flag).

### Output

- Assignments: participant, session, rank achieved (or `locked` / `filled`).
- Unassigned slots with a reason, e.g. "all ranked workshops full or overlapping".
- Metrics: share getting their first choice, rank distribution, unfilled slots, worst-off participant.
- A short trace per participant so an organizer can answer "why did I get this?".
  Organizers can also show it to participants (per-event toggle, default off), so
  it must never mention other participants.
- Engine version, seed, and input hash, for reproducibility.

## Hard constraints

1. Session capacity.
2. No overlapping sessions for one participant.
3. At most one session per workshop per participant.
4. Eligibility (e.g. age group).
5. Locked assignments stay unchanged and count against capacity.

## Strategies

Every strategy is a combination of an **ordering** (who chooses first) and a
**round structure** (how turns proceed). That gives organizers named choices
while keeping one code path.

| Strategy (organizer-facing name) | Ordering | Rounds | Best for |
|---|---|---|---|
| **Take turns** (default) | Random, seeded | Snake: each round everyone gets their best still-feasible choice, and the order reverses each round | Fair spread of first choices; easy to explain |
| **Early birds first** | By preference submission time | Snake | Organizers who promised that signing up early counts |

In each turn the participant gets their highest-ranked workshop that still has a
feasible session (capacity, no overlap, eligible). If several sessions of that
workshop fit, pick the one that leaves the most room for their remaining choices
(fewest conflicts with their other ranked workshops), then the emptiest.

After the rounds, an optional **swap pass** tries pairwise swaps between
participants that make at least one better off and nobody worse off. It's cheap,
and it fixes most of the obvious "we could have just traded" complaints. This is
a stretch goal for the MVP (decision D11).

### Deferred to Phase 2

- **Maximise overall satisfaction** (ILP or similar). With overlap constraints
  this isn't a simple matching problem, so it needs a solver and real
  benchmarks. It's also harder to explain to participants.
- Group constraints (friends together, siblings apart), weighted priorities
  (e.g. first-time attendees), minimum attendance for a workshop to run.

## Lifecycle

```
draft run ──► organizer review (metrics, per-person view, manual moves)
          ──► publish ──► participants see itinerary, emails queued
```

- Each run is stored as an immutable `allocation_run` row with its input
  snapshot, seed, engine version and result. Re-running creates a new run.
- Manual moves during review are recorded as overrides on the draft and
  validated against the same hard constraints.
- Publishing goes through the event's Durable Object (see
  [architecture.md](architecture.md)), which writes assignments in one D1 batch
  tagged with the run id, enqueues notifications and broadcasts the new status.
  Only one run per event can be published; a second publish shows a diff of
  who moves before confirming.
- **After publishing, the MVP has no automatic reallocation.** Changes are
  manual moves, cancellations free a seat, and the waitlist fills it. Re-running
  over a published allocation (locking what participants already have) is Phase 2.

## Hybrid in the MVP

Only one form: an organizer can place specific participants in sessions
(facilitator helpers, special needs), and those become locked inputs. A
single event mixing participant self-booking for some time blocks and ranking for
others is Phase 2.

## Execution on Cloudflare

For the target event (200 participants, 60 sessions, 3 slots each), a snake
draft is on the order of 200 × 3 × 60 feasibility checks: milliseconds. So in
the MVP:

- Run the allocation **inside the organizer's request** (a server function in
  `web`), store the draft run in D1, return the metrics.
- **No Workflows yet.** Publishing is one D1 batch (via the event's Durable
  Object) plus Queue messages; the `jobs` consumer handles email retries
  idempotently (keyed on run id + participant).
- Introduce a Workflow when allocation or publishing outgrows a request, or when
  we need waiting steps such as "publish at 18:00".

### Benchmark before trusting this

Generate synthetic events and measure CPU time in `wrangler dev` and in a
deployed Worker:

| Size | Participants | Workshops | Sessions |
|---|---|---|---|
| Target | 200 | 20 | 60 |
| Large camp | 2,000 | 100 | 400 |
| Stress | 10,000 | 300 | 1,200 |

If the stress case exceeds the Worker CPU limit, that's when a Workflow step
(or later a container for a solver) comes in. Check current Worker CPU limits
before the benchmark (**unverified** here).

## Data model sketch

```
allocation_run (id, event_id, status: draft|published|superseded,
                strategy, seed, engine_version, input_hash,
                input_snapshot (R2 key if large), metrics_json, created_by, created_at)
allocation_override (run_id, registration_id, session_id, action, by, at)
assignment (id, registration_id, session_id,
            source: booking|allocation|manual, run_id nullable, created_at)
```

`assignment` is the single source of truth for itineraries, whichever mode
produced it.
