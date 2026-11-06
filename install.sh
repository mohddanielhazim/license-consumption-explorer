#!/usr/bin/env bash
# Installs License Consumption Explorer into a Dynatrace environment (Mac and Linux).
# No Node.js needed: it uploads the ready-built app in package/ with curl, which
# comes with macOS. Asks for the environment address and an OAuth client with the
# scope app-engine:apps:install. Nothing typed here is saved anywhere.
set -euo pipefail
cd "$(dirname "$0")"
echo "License Consumption Explorer: install"
echo

PKG="$(ls package/app-v*.zip 2>/dev/null | tail -n 1 || true)"
if [ -z "$PKG" ]; then
  echo "The app package (package/app-v....zip) is missing. Run this from the unzipped hand-over folder."
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "curl is not available on this computer. It comes with macOS; on Linux, install it and run this again."
  exit 1
fi

read -r -p "Environment address (for example https://abc12345.apps.dynatrace.com): " ENV_URL
ENV_URL="${ENV_URL%/}"
case "$ENV_URL" in
  https://*.apps.dynatrace.com) SSO="https://sso.dynatrace.com" ;;
  *) echo "Use the environment's own address, like https://abc12345.apps.dynatrace.com."
     echo "A company address (for example https://dynatrace.yourcompany.com) won't work here. The own address is the one"
     echo "the browser shows after you sign in, or under Account Management > Environments."; exit 1 ;;
esac
# Ask the environment where it signs in (some use their own
# address); keep the default above if it doesn't say.
FOUND="$(curl -s -o /dev/null -w '%{redirect_url}' "$ENV_URL/platform/oauth2/authorization/dynatrace-sso" 2>/dev/null | sed -n -E 's#^(https://sso[^/]*\.dynatrace(labs)?\.com).*#\1#p' || true)"
if [ -n "$FOUND" ]; then SSO="$FOUND"; fi
read -r -p "OAuth client ID (dt0s02....): " CLIENT_ID
read -r -s -p "OAuth client secret (hidden as you type): " CLIENT_SECRET
echo
echo

echo "Signing in with the OAuth client..."
# The secret goes to curl through a pipe, so it never appears in the list of running programs.
TOKEN_JSON="$(printf '%s' "$CLIENT_SECRET" | curl -sS -X POST "$SSO/sso/oauth2/token" \
  -H "content-type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "client_secret@-" \
  --data-urlencode "scope=app-engine:apps:install")"
unset CLIENT_SECRET
TOKEN="$(printf '%s' "$TOKEN_JSON" | sed -n 's/.*"access_token" *: *"\([^"]*\)".*/\1/p')"
if [ -z "$TOKEN" ]; then
  echo "Sign-in failed. Check the client ID and secret, and that the client has the scope app-engine:apps:install."
  echo "Dynatrace said: $(printf '%s' "$TOKEN_JSON" | head -c 400)"
  exit 1
fi

echo "Uploading $(basename "$PKG") to $ENV_URL ..."
RESPONSE="$(mktemp)"
STATUS="$(curl -sS -o "$RESPONSE" -w "%{http_code}" -X POST "$ENV_URL/platform/app-engine/registry/v1/apps" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/zip" \
  --data-binary "@$PKG")"
unset TOKEN
if [ "${STATUS:0:1}" != "2" ]; then
  echo "The upload failed (HTTP $STATUS)."
  echo "Dynatrace said: $(head -c 600 "$RESPONSE")"
  rm -f "$RESPONSE"
  exit 1
fi
rm -f "$RESPONSE"

echo
echo "Done. Open: $ENV_URL/ui/apps/my.license.consumption.explorer"
echo "Then go through FIRST-RUN-CHECK.md."
