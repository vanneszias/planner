#!/usr/bin/env bash
# A full dev environment per branch (docs/previews.md).
#
#   scripts/preview.sh up [branch]     create or update it
#   scripts/preview.sh down [branch]   delete it
#   scripts/preview.sh prune           delete those whose branch is gone
#
# The branch defaults to WORKERS_CI_BRANCH (set by Workers Builds), then the
# checked-out one. `up` needs PREVIEW_AUTH_SECRET and PREVIEW_EXPORT_KEY in the
# environment. All commands are safe to run again.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=scripts/cloudflare-env.sh
source "$root/scripts/cloudflare-env.sh"

action=${1:-}
if [[ ! $action =~ ^(up|down|prune)$ ]]; then
	echo "usage: scripts/preview.sh up|down [branch] | prune" >&2
	exit 1
fi

bucket="event-files-preview"
subdomain=${WORKERS_SUBDOMAIN:-zias}
repo=${PREVIEW_REPO:-https://github.com/vanneszias/planner.git}

wrangler() { pnpm --dir "$root/apps/web" exec wrangler "$@"; }
database_id() {
	wrangler d1 list --json |
		node -e 'const dbs = JSON.parse(require("fs").readFileSync(0)); console.log(dbs.find((d) => d.name === process.argv[1])?.uuid ?? "")' "$1"
}

# Branch name -> "pv-<slug>". The prefix keeps it clear of production names
# (event-jobs-dlq); the length keeps event-coordinator-pv-<slug> within 63.
slug() {
	local s
	s=$(printf %s "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
	if ((${#s} > 40)); then
		s="${s:0:33}"
		s="${s%-}-$(printf %s "$1" | cksum | cut -d' ' -f1 | cut -c1-6)"
	fi
	echo "pv-$s"
}

down() {
	local suffix="-$1"
	# A queue consumer can't be deleted, and a queue with one can't either.
	wrangler queues consumer remove "event-jobs$suffix" "event-jobs$suffix" || echo "event-jobs$suffix: no consumer to remove"
	# Dependents first: the coordinator's Durable Object class is bound by the others.
	for worker in web api jobs coordinator; do
		wrangler delete --name "event-$worker$suffix" --force || echo "event-$worker$suffix: nothing to delete"
	done
	wrangler queues delete "event-jobs$suffix" || echo "event-jobs$suffix: nothing to delete"
	if [[ -n $(database_id "event-db$suffix") ]]; then
		wrangler d1 delete "event-db$suffix" -y
	else
		echo "event-db$suffix: nothing to delete"
	fi
}

if [[ $action == prune ]]; then
	# Every environment has a database, so the databases list them all.
	live=$(git ls-remote --heads "$repo" | sed 's#.*refs/heads/##' | while read -r b; do slug "$b"; done)
	for db in $(wrangler d1 list --json | node -e 'for (const d of JSON.parse(require("fs").readFileSync(0))) if (d.name.startsWith("event-db-pv-")) console.log(d.name)'); do
		name=${db#event-db-}
		if ! grep -qx "$name" <<<"$live"; then
			echo "Pruning $name: its branch is gone"
			down "$name"
		fi
	done
	exit 0
fi

branch=${2:-${WORKERS_CI_BRANCH:-$(git -C "$root" branch --show-current)}}
if [[ -z $branch || $branch == master ]]; then
	echo "No preview for '${branch:-detached HEAD}': pass a branch name" >&2
	exit 1
fi
name=$(slug "$branch")
suffix="-$name"
db="event-db$suffix"
queue="event-jobs$suffix"

if [[ $action == down ]]; then
	down "$name"
	exit 0
fi

: "${PREVIEW_AUTH_SECRET:?set PREVIEW_AUTH_SECRET}"
: "${PREVIEW_EXPORT_KEY:?set PREVIEW_EXPORT_KEY}"

echo "Preview for $branch: $name"
id=$(database_id "$db")
if [[ -z $id ]]; then
	wrangler d1 create "$db" --jurisdiction eu
	id=$(database_id "$db")
fi
wrangler queues info "$queue" >/dev/null 2>&1 || wrangler queues create "$queue" --jurisdiction eu
wrangler r2 bucket list --jurisdiction eu | grep -q "^name:\s*$bucket$" ||
	wrangler r2 bucket create "$bucket" --jurisdiction eu

node "$root/scripts/preview-config.mjs" "$name" "$id"

secrets=$(mktemp)
trap 'rm -f "$secrets"' EXIT
node -e '
	const { PREVIEW_AUTH_SECRET, PREVIEW_EXPORT_KEY } = process.env
	require("fs").writeFileSync(process.argv[1], JSON.stringify({
		BETTER_AUTH_SECRET: PREVIEW_AUTH_SECRET,
		EXPORT_SIGNING_KEY: PREVIEW_EXPORT_KEY,
		TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
	}))
' "$secrets"

cd "$root/apps/web"
wrangler d1 migrations apply DB --remote -c wrangler.preview.json

# Same order as production: the coordinator defines the Durable Object class.
(cd ../coordinator && pnpm exec wrangler deploy -c wrangler.preview.json)
(cd ../jobs && pnpm exec wrangler deploy -c wrangler.preview.json)
(cd ../api && pnpm exec wrangler deploy -c wrangler.preview.json --secrets-file "$secrets")
PREVIEW_CONFIG=1 pnpm build
pnpm exec wrangler deploy --secrets-file "$secrets"

url="https://event-web$suffix.$subdomain.workers.dev"
curl --fail --silent --retry 5 --retry-delay 5 --retry-all-errors "$url/health" >/dev/null
echo "Preview ready: $url"
