#!/usr/bin/env bash
# A full dev environment per pull request (docs/previews.md).
#
#   scripts/preview.sh up <pr-number>     create or update it
#   scripts/preview.sh down <pr-number>   delete it
#
# `up` needs PREVIEW_AUTH_SECRET and PREVIEW_EXPORT_KEY in the environment.
# Both commands are safe to run again.
set -euo pipefail

action=${1:-}
pr=${2:-}
if [[ ! $action =~ ^(up|down)$ || ! $pr =~ ^[0-9]+$ ]]; then
	echo "usage: scripts/preview.sh up|down <pr-number>" >&2
	exit 1
fi

root=$(cd "$(dirname "$0")/.." && pwd)
suffix="-pr-$pr"
db="event-db$suffix"
queue="event-jobs$suffix"
bucket="event-files-preview"
subdomain=${WORKERS_SUBDOMAIN:-zias}

wrangler() { pnpm --dir "$root/apps/web" exec wrangler "$@"; }
database_id() { wrangler d1 list --json | jq -r --arg name "$db" '.[] | select(.name == $name) | .uuid'; }

if [[ $action == down ]]; then
	# Dependents first: the coordinator's Durable Object class is bound by the others.
	for worker in web api jobs coordinator; do
		wrangler delete --name "event-$worker$suffix" --force || echo "event-$worker$suffix: nothing to delete"
	done
	wrangler queues delete "$queue" || echo "$queue: nothing to delete"
	if [[ -n $(database_id) ]]; then wrangler d1 delete "$db" -y; else echo "$db: nothing to delete"; fi
	exit 0
fi

: "${PREVIEW_AUTH_SECRET:?set PREVIEW_AUTH_SECRET}"
: "${PREVIEW_EXPORT_KEY:?set PREVIEW_EXPORT_KEY}"

id=$(database_id)
if [[ -z $id ]]; then
	wrangler d1 create "$db" --jurisdiction eu
	id=$(database_id)
fi
wrangler queues info "$queue" >/dev/null 2>&1 || wrangler queues create "$queue" --jurisdiction eu
wrangler r2 bucket list --jurisdiction eu | grep -q "^name:\s*$bucket$" ||
	wrangler r2 bucket create "$bucket" --jurisdiction eu

node "$root/scripts/preview-config.mjs" "$pr" "$id"

secrets=$(mktemp)
trap 'rm -f "$secrets"' EXIT
jq -n \
	--arg auth "$PREVIEW_AUTH_SECRET" \
	--arg export "$PREVIEW_EXPORT_KEY" \
	'{
		BETTER_AUTH_SECRET: $auth,
		EXPORT_SIGNING_KEY: $export,
		TURNSTILE_SECRET: "1x0000000000000000000000000000000AA"
	}' >"$secrets"

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
echo "$url"
