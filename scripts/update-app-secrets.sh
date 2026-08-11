#!/usr/bin/env bash
# Merges real values into foundry/app-secrets in AWS Secrets Manager.
# Run this yourself from a real terminal — Claude Code won't run it for you
# (it never handles the actual secret values, by design).
#
# Sources CLERK_SECRET_KEY, CLERK_JWKS_URL, STRIPE_SECRET_KEY from
# apps/web/.env.local, and RESEND_API_KEY from apps/agent-runtime/.env.
# Still leaves ANTHROPIC_API_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRO_PRICE_ID
# as REPLACE_ME — pass them as env vars to fill those in too, e.g.:
#   ANTHROPIC_API_KEY=sk-ant-... STRIPE_WEBHOOK_SECRET=whsec_... ./scripts/update-app-secrets.sh
#
# Double-check CLERK_SECRET_KEY / STRIPE_SECRET_KEY in apps/web/.env.local
# are LIVE-mode keys (sk_live_...), not test-mode (sk_test_...), before
# running this against production — a test-mode key will make the app boot
# but real users won't be able to sign in or pay.

set -euo pipefail
cd "$(dirname "$0")/.."

WEB_ENV="apps/web/.env.local"
RUNTIME_ENV="apps/agent-runtime/.env"

get_val() { grep -E "^$1=" "$2" 2>/dev/null | head -1 | cut -d= -f2- ; }

CLERK_SECRET_KEY_VAL="$(get_val CLERK_SECRET_KEY "$WEB_ENV")"
STRIPE_SECRET_KEY_VAL="$(get_val STRIPE_SECRET_KEY "$WEB_ENV")"
CLERK_JWKS_URL_VAL="$(get_val CLERK_JWKS_URL "$RUNTIME_ENV")"
RESEND_API_KEY_VAL="$(get_val RESEND_API_KEY "$RUNTIME_ENV")"

for name in CLERK_SECRET_KEY_VAL STRIPE_SECRET_KEY_VAL CLERK_JWKS_URL_VAL RESEND_API_KEY_VAL; do
  if [ -z "${!name}" ]; then
    echo "Missing $name — check $WEB_ENV / $RUNTIME_ENV" >&2
    exit 1
  fi
done

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

aws secretsmanager get-secret-value --secret-id foundry/app-secrets --query SecretString --output text \
  | jq --arg clerk_secret "$CLERK_SECRET_KEY_VAL" \
       --arg clerk_jwks "$CLERK_JWKS_URL_VAL" \
       --arg stripe_secret "$STRIPE_SECRET_KEY_VAL" \
       --arg resend "$RESEND_API_KEY_VAL" \
       --arg anthropic "${ANTHROPIC_API_KEY:-}" \
       --arg stripe_webhook "${STRIPE_WEBHOOK_SECRET:-}" \
       --arg stripe_price "${STRIPE_PRO_PRICE_ID:-}" \
       '.CLERK_SECRET_KEY = $clerk_secret
        | .CLERK_JWKS_URL = $clerk_jwks
        | .STRIPE_SECRET_KEY = $stripe_secret
        | .RESEND_API_KEY = $resend
        | (if $anthropic != "" then .ANTHROPIC_API_KEY = $anthropic else . end)
        | (if $stripe_webhook != "" then .STRIPE_WEBHOOK_SECRET = $stripe_webhook else . end)
        | (if $stripe_price != "" then .STRIPE_PRO_PRICE_ID = $stripe_price else . end)' \
  > "$TMP"

aws secretsmanager put-secret-value --secret-id foundry/app-secrets --secret-string "file://$TMP"

echo "Updated. Remaining placeholders:"
jq -r 'to_entries[] | select(.value == "REPLACE_ME") | .key' "$TMP"
