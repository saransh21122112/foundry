#!/usr/bin/env bash
# Merges real values into foundry/app-secrets in AWS Secrets Manager.
# Run this yourself from a real terminal — Claude Code won't run it for you
# (it never handles the actual secret values, by design).
#
# Also adds any of the 10 keys the ECS task definitions reference
# (GITHUB_OAUTH_CLIENT_ID/SECRET, GITHUB_TOKEN_ENCRYPTION_KEY,
# GOOGLE_OAUTH_CLIENT_ID/SECRET, TELEGRAM_BOT_TOKEN/USERNAME/
# WEBHOOK_SECRET_TOKEN, TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER) that are
# CURRENTLY MISSING FROM THE SECRET ENTIRELY — confirmed live (2026-08-11)
# as the actual cause of every ECS deploy failing at task launch
# ("retrieved secret from Secrets Manager did not contain json key
# GITHUB_OAUTH_CLIENT_ID") and silently rolling back via the circuit
# breaker. ECS requires the JSON *key* to exist even for features you don't
# use yet — an empty string is enough to stop the crash loop; a real value
# is only needed once you actually wire up that integration. This script
# defaults every missing key to "" unless you pass a real value as an env
# var, so it's always safe to run even if you only have some of them.
#
# Sources CLERK_SECRET_KEY, CLERK_JWKS_URL, STRIPE_SECRET_KEY from
# apps/web/.env.local, and RESEND_API_KEY from apps/agent-runtime/.env.
# Pass any other key as an env var to set/update it, e.g.:
#   ANTHROPIC_API_KEY=sk-ant-... GITHUB_OAUTH_CLIENT_ID=... ./scripts/update-app-secrets.sh
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
       --arg github_client_id "${GITHUB_OAUTH_CLIENT_ID:-}" \
       --arg github_client_secret "${GITHUB_OAUTH_CLIENT_SECRET:-}" \
       --arg github_token_key "${GITHUB_TOKEN_ENCRYPTION_KEY:-}" \
       --arg google_client_id "${GOOGLE_OAUTH_CLIENT_ID:-}" \
       --arg google_client_secret "${GOOGLE_OAUTH_CLIENT_SECRET:-}" \
       --arg telegram_bot_token "${TELEGRAM_BOT_TOKEN:-}" \
       --arg telegram_bot_username "${TELEGRAM_BOT_USERNAME:-}" \
       --arg telegram_webhook_secret "${TELEGRAM_WEBHOOK_SECRET_TOKEN:-}" \
       --arg twilio_sid "${TWILIO_ACCOUNT_SID:-}" \
       --arg twilio_token "${TWILIO_AUTH_TOKEN:-}" \
       --arg twilio_from "${TWILIO_FROM_NUMBER:-}" \
       '.CLERK_SECRET_KEY = $clerk_secret
        | .CLERK_JWKS_URL = $clerk_jwks
        | .STRIPE_SECRET_KEY = $stripe_secret
        | .RESEND_API_KEY = $resend
        | (if $anthropic != "" then .ANTHROPIC_API_KEY = $anthropic else . end)
        | (if $stripe_webhook != "" then .STRIPE_WEBHOOK_SECRET = $stripe_webhook else . end)
        | (if $stripe_price != "" then .STRIPE_PRO_PRICE_ID = $stripe_price else . end)
        # Keys the task definitions require to exist at all — default to ""
        # (only) if genuinely missing, never overwrite an existing value
        # (real or otherwise) with an env var you did not pass.
        | (if has("GITHUB_OAUTH_CLIENT_ID") then . else .GITHUB_OAUTH_CLIENT_ID = $github_client_id end)
        | (if has("GITHUB_OAUTH_CLIENT_SECRET") then . else .GITHUB_OAUTH_CLIENT_SECRET = $github_client_secret end)
        | (if has("GITHUB_TOKEN_ENCRYPTION_KEY") then . else .GITHUB_TOKEN_ENCRYPTION_KEY = $github_token_key end)
        | (if has("GOOGLE_OAUTH_CLIENT_ID") then . else .GOOGLE_OAUTH_CLIENT_ID = $google_client_id end)
        | (if has("GOOGLE_OAUTH_CLIENT_SECRET") then . else .GOOGLE_OAUTH_CLIENT_SECRET = $google_client_secret end)
        | (if has("TELEGRAM_BOT_TOKEN") then . else .TELEGRAM_BOT_TOKEN = $telegram_bot_token end)
        | (if has("TELEGRAM_BOT_USERNAME") then . else .TELEGRAM_BOT_USERNAME = $telegram_bot_username end)
        | (if has("TELEGRAM_WEBHOOK_SECRET_TOKEN") then . else .TELEGRAM_WEBHOOK_SECRET_TOKEN = $telegram_webhook_secret end)
        | (if has("TWILIO_ACCOUNT_SID") then . else .TWILIO_ACCOUNT_SID = $twilio_sid end)
        | (if has("TWILIO_AUTH_TOKEN") then . else .TWILIO_AUTH_TOKEN = $twilio_token end)
        | (if has("TWILIO_FROM_NUMBER") then . else .TWILIO_FROM_NUMBER = $twilio_from end)
        # Any of the above already present get the env var applied too, if one was passed.
        | (if $github_client_id != "" then .GITHUB_OAUTH_CLIENT_ID = $github_client_id else . end)
        | (if $github_client_secret != "" then .GITHUB_OAUTH_CLIENT_SECRET = $github_client_secret else . end)
        | (if $github_token_key != "" then .GITHUB_TOKEN_ENCRYPTION_KEY = $github_token_key else . end)
        | (if $google_client_id != "" then .GOOGLE_OAUTH_CLIENT_ID = $google_client_id else . end)
        | (if $google_client_secret != "" then .GOOGLE_OAUTH_CLIENT_SECRET = $google_client_secret else . end)
        | (if $telegram_bot_token != "" then .TELEGRAM_BOT_TOKEN = $telegram_bot_token else . end)
        | (if $telegram_bot_username != "" then .TELEGRAM_BOT_USERNAME = $telegram_bot_username else . end)
        | (if $telegram_webhook_secret != "" then .TELEGRAM_WEBHOOK_SECRET_TOKEN = $telegram_webhook_secret else . end)
        | (if $twilio_sid != "" then .TWILIO_ACCOUNT_SID = $twilio_sid else . end)
        | (if $twilio_token != "" then .TWILIO_AUTH_TOKEN = $twilio_token else . end)
        | (if $twilio_from != "" then .TWILIO_FROM_NUMBER = $twilio_from else . end)' \
  > "$TMP"

aws secretsmanager put-secret-value --secret-id foundry/app-secrets --secret-string "file://$TMP"

echo "Updated. Remaining REPLACE_ME placeholders:"
jq -r 'to_entries[] | select(.value == "REPLACE_ME") | .key' "$TMP"
echo "Remaining empty (deploy-safe, but that integration won't work until set):"
jq -r 'to_entries[] | select(.value == "") | .key' "$TMP"
