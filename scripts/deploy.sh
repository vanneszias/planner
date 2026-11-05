#!/usr/bin/env bash
# Production deploy, run by Workers Builds on every push to master
# (docs/previews.md, "Deploys"). Migrate, then deploy in dependency order: the
# coordinator defines the Durable Object class the others bind to.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=scripts/cloudflare-env.sh
source "$root/scripts/cloudflare-env.sh"

(cd "$root/apps/web" && pnpm exec wrangler d1 migrations apply DB --remote)
for app in coordinator jobs api; do
	(cd "$root/apps/$app" && pnpm exec wrangler deploy)
done
(cd "$root/apps/web" && pnpm build && pnpm exec wrangler deploy)

curl --fail --retry 3 --retry-delay 5 https://event-web.zias.workers.dev/health

# Merged branches leave their preview behind; a failure here doesn't fail the deploy.
"$root/scripts/preview.sh" prune || echo "Preview prune failed; run scripts/preview.sh prune by hand"
