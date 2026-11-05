# Sourced by deploy.sh and preview.sh: the account, and the token to use.
export CLOUDFLARE_ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID:-6495d15c9d09b19ddc65f0a01892a183}
# Workers Builds sets CLOUDFLARE_API_TOKEN to the Worker's build token. DEPLOY_API_TOKEN
# (a build secret) overrides it when that token lacks D1 or Queues permissions.
if [[ -n ${DEPLOY_API_TOKEN:-} ]]; then export CLOUDFLARE_API_TOKEN=$DEPLOY_API_TOKEN; fi
