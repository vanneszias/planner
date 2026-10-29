# Planning docs

"Planner" is a working name. These documents hold product and architecture
decisions; no application code exists yet.

| Doc                                              | Contents                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [implementation-plan.md](implementation-plan.md) | Build order, tooling, M0 task list, blockers                                                     |
| [decisions.md](decisions.md)                     | Confirmed product and architecture decisions, capacity enforcement                               |
| [architecture.md](architecture.md)               | Workers, the per-event Durable Object, monorepo layout                                           |
| [eu-data-residency.md](eu-data-residency.md)     | How each Cloudflare service is pinned to the EU, verified against docs                           |
| [domain-model.md](domain-model.md)               | Entities, D1 tables, indexes, tenant scoping, retention, migrations                              |
| [security-privacy.md](security-privacy.md)       | Threat model, rate limits, Turnstile placement, GDPR documents, pre-pilot checklist              |
| [journeys.md](journeys.md)                       | Participant and organizer flows, screen by screen, with edge cases                               |
| [design-system.md](design-system.md)             | Visual direction: markers and day strip, colour, type, layouts, components, accessibility, voice |
| [mvp-and-roadmap.md](mvp-and-roadmap.md)         | MVP scope, milestones, roadmap phases, validation experiments, risks                             |
| [allocation-mvp.md](allocation-mvp.md)           | Allocation engine scope for the MVP: inputs, outputs, strategies, lifecycle                      |

Each claim about Cloudflare behaviour links to the official page it came from.
Anything marked **unverified** still needs a doc check or a test.
