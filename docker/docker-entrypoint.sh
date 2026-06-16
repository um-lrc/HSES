#!/bin/sh
set -eu

CONFIG_PATH="/usr/share/nginx/html/runtime-config.js"
KEY="${GEMINI_API_KEY:-}"

printf 'window.__RUNTIME_CONFIG__ = %s;\n' \
  "$(jq -nc --arg key "$KEY" '{GEMINI_API_KEY: $key, API_KEY: $key}')" \
  > "$CONFIG_PATH"

exec nginx -g 'daemon off;'
