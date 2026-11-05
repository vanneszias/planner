# Sourced by deploy.sh and preview.sh: the account, and the token to use.
export CLOUDFLARE_ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID:-6495d15c9d09b19ddc65f0a01892a183}
# Workers Builds sets CLOUDFLARE_API_TOKEN to the Worker's build token. DEPLOY_API_TOKEN
# (a build secret) overrides it when that token lacks D1 or Queues permissions.
if [[ -n ${DEPLOY_API_TOKEN:-} ]]; then export CLOUDFLARE_API_TOKEN=$DEPLOY_API_TOKEN; fi
# Workers Builds sets WRANGLER_CI_OVERRIDE_NAME to the connected Worker (event-web), and
# wrangler then deploys every `wrangler deploy` under that name, overwriting event-web
# with the coordinator, jobs and api code. Each config already names its own Worker, so
# drop the override and let the config's name decide.
unset WRANGLER_CI_OVERRIDE_NAME
