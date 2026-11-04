# Pull request previews

Every pull request from this repository gets its own dev environment, so
changes, including schema changes, can be tried without touching production
data. This replaces the earlier per-version preview URLs, which shared the
production database (decision 2026-10-30, superseded 2026-11-04).

## What a preview is

For pull request `N`:

| Resource           | Name                                      | Notes                                       |
| ------------------ | ----------------------------------------- | ------------------------------------------- |
| D1 database (`eu`) | `event-db-pr-N`                           | Empty; all migrations applied on each push  |
| Queue (`eu`)       | `event-jobs-pr-N`                         | No dead-letter queue                        |
| Workers            | `event-{coordinator,jobs,api,web}-pr-N`   | Own Durable Object namespace                |
| R2 bucket (`eu`)   | `event-files-preview`                     | Shared by all previews; keys are random ids |
| URL                | `https://event-web-pr-N.zias.workers.dev` | Posted as a comment on the pull request     |

Differences from production:

- **Emails are logged, not sent** (`EMAIL_DELIVERY=console`). Sign-in links
  appear in the `event-web-pr-N` Worker's logs (dashboard, or
  `wrangler tail event-web-pr-N`).
- **Turnstile uses Cloudflare's always-pass test keys.**
- **No cron triggers**, since the account's cron limit is shared with
  production. Scheduled work (retention, automatic decisions) doesn't run.
- Rate limit counters are shared with production (same namespaces).
- `BETTER_AUTH_SECRET` and `EXPORT_SIGNING_KEY` come from the GitHub secrets
  `PREVIEW_AUTH_SECRET` and `PREVIEW_EXPORT_KEY`, the same for every preview
  and never the production values.

Pull requests from forks get no preview: they can't read the secrets.

## How it works

- `scripts/preview-config.mjs` writes `wrangler.preview.json` next to each
  app's `wrangler.jsonc` (git-ignored), renaming the Worker and pointing its
  bindings and URLs at the pull request's resources.
- `scripts/preview.sh up N` creates the database and queue if missing, applies
  migrations, deploys the four Workers in production order and checks
  `/health`. The web build reads the preview configs when `PREVIEW_CONFIG` is set
  (`apps/web/vite.config.ts`).
- `scripts/preview.sh down N` deletes the Workers, queue and database.
- CI (`.github/workflows/ci.yml`, job `preview`) runs `up` after the checks pass
  on every push to a pull request. `.github/workflows/preview-cleanup.yml` runs
  `down` when it closes; run that workflow by hand with a number to remove one
  left behind.

Both commands can run locally with a logged-in Wrangler (`up` also needs the two
secrets in the environment).
