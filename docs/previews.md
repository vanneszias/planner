# Deploys and branch previews

Cloudflare Workers Builds (Cloudflare's GitHub integration) deploys
production from `master` and gives every other branch its own dev environment,
so changes, including schema changes, can be tried without touching production
data. This replaces GitHub Actions (2026-11-05: Actions stopped running jobs
after a GitHub billing lock) and, before that, per-version preview URLs that
shared the production database (2026-10-30, superseded 2026-11-04).

Cloudflare's built-in Workers Previews don't fit here: a preview can't consume
a queue, run crons or bind a Durable Object in another Worker, and it calls the
other Workers' production deployments. So a preview here is a separate set of
Workers and resources, deployed by `scripts/preview.sh`.

## Workers Builds setup

Only the `event-web` Worker is connected to the repository; its build deploys
all four Workers, in order. Settings > Build on `event-web`:

| Setting                          | Value                                                           |
| -------------------------------- | --------------------------------------------------------------- |
| Git repository / branch          | `vanneszias/planner`, production branch `master`                |
| Root directory                   | empty (repository root)                                         |
| Build command                    | `pnpm check` (lint, typecheck, tests)                           |
| Deploy command                   | `scripts/deploy.sh`                                             |
| Preview command (other branches) | `scripts/preview.sh up`                                         |
| Enable Preview Builds            | on                                                              |
| Build secrets                    | `PREVIEW_AUTH_SECRET`, `PREVIEW_EXPORT_KEY`, `DEPLOY_API_TOKEN` |

The other three Workers stay disconnected, so a push builds once.

The default build token can't manage D1 or Queues, so `DEPLOY_API_TOKEN` holds
a user API token ("Edit Cloudflare Workers" template plus D1, Queues and Workers
R2 Storage edit). `scripts/cloudflare-env.sh` uses it in place of the build token.

## Production (`master`)

`scripts/deploy.sh` applies D1 migrations, deploys `coordinator`, `jobs`, `api`
and `web` in that order (the coordinator defines the Durable Object class the
others bind to), checks `/health`, then prunes previews of deleted branches.

Production is served on Workers custom domains only: `web` on
`https://events.zias.be`, `api` on `https://api.events.zias.be`
(`workers_dev: false`). Previews drop those routes and use `workers.dev`.

## What a preview is

For a branch, `scripts/preview.sh` derives a name `pv-<slug>`: the branch name
lowercased, with runs of other characters turned into `-`, cut to 40 characters
(with a checksum when cut). `zias/new-polls` becomes `pv-zias-new-polls`.

| Resource           | Name                                           | Notes                                       |
| ------------------ | ---------------------------------------------- | ------------------------------------------- |
| D1 database (`eu`) | `event-db-pv-<slug>`                           | Empty; all migrations applied on each push  |
| Queue (`eu`)       | `event-jobs-pv-<slug>`                         | No dead-letter queue                        |
| Workers            | `event-{coordinator,jobs,api,web}-pv-<slug>`   | Own Durable Object namespace                |
| R2 bucket (`eu`)   | `event-files-preview`                          | Shared by all previews; keys are random ids |
| URL                | `https://event-web-pv-<slug>.zias.workers.dev` | Last line of the build log                  |

Every pushed branch gets one, with or without a pull request. Workers Builds
comments the build status on the pull request; the URL is in the build log.

Differences from production:

- **Emails are logged, not sent** (`EMAIL_DELIVERY=console`). Sign-in links
  appear in the `event-web-pv-<slug>` Worker's logs (dashboard, or
  `wrangler tail event-web-pv-<slug>`).
- **Turnstile uses Cloudflare's always-pass test keys.**
- **No cron triggers**, since the account's cron limit is shared with
  production. Scheduled work (retention, automatic decisions) doesn't run.
- Rate limit counters are shared with production (same namespaces).
- `BETTER_AUTH_SECRET` and `EXPORT_SIGNING_KEY` come from the build secrets
  `PREVIEW_AUTH_SECRET` and `PREVIEW_EXPORT_KEY`, the same for every preview
  and never the production values.

## How it works

- `scripts/preview-config.mjs` writes `wrangler.preview.json` next to each
  app's `wrangler.jsonc` (git-ignored), renaming the Worker and pointing its
  bindings and URLs at the branch's resources.
- `scripts/preview.sh up [branch]` creates the database and queue if missing,
  applies migrations, deploys the four Workers in production order and checks
  `/health`. The branch defaults to `WORKERS_CI_BRANCH`, then the checked-out
  one. The web build reads the preview configs when `PREVIEW_CONFIG` is set
  (`apps/web/vite.config.ts`).
- `scripts/preview.sh down [branch]` deletes the Workers, queue and database.
- `scripts/preview.sh prune` deletes every preview whose branch no longer exists
  on GitHub. Workers Builds has no "pull request closed" event, so a preview
  lives until its branch is deleted and the next production deploy runs.

All commands can run locally with a logged-in Wrangler (`up` also needs the two
preview secrets in the environment).
