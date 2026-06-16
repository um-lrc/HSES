#!/bin/sh
set -eu

INDEX_PATH="/usr/share/nginx/html/index.html"
CONFIG_PATH="/usr/share/nginx/html/runtime-config.js"
KEY="${GEMINI_API_KEY:-}"
PLACEHOLDER='window.__RUNTIME_CONFIG__={"GEMINI_API_KEY":"","API_KEY":""};'

CONFIG_JSON="$(jq -nc --arg key "$KEY" '{GEMINI_API_KEY: $key, API_KEY: $key}')"
SCRIPT_LINE="window.__RUNTIME_CONFIG__ = ${CONFIG_JSON};"

printf '%s\n' "$SCRIPT_LINE" > "$CONFIG_PATH"

if grep -q "$PLACEHOLDER" "$INDEX_PATH"; then
  sed -i "s|$(printf '%s' "$PLACEHOLDER" | sed 's/[&|\\]/\\&/g')|$(printf '%s' "$SCRIPT_LINE" | sed 's/[&|\\]/\\&/g')|" "$INDEX_PATH"
else
  sed -i "s|window.__RUNTIME_CONFIG__ = {[^;]*};|$(printf '%s' "$SCRIPT_LINE" | sed 's/[&|\\]/\\&/g')|" "$INDEX_PATH"
fi

if [ -z "$KEY" ]; then
  echo "WARNING: GEMINI_API_KEY is empty. Set it in Portainer stack environment variables and redeploy." >&2
fi

exec nginx -g 'daemon off;'
