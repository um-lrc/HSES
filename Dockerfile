# syntax=docker/dockerfile:1
# Static Vite build served by nginx. GEMINI_API_KEY is injected at container start
# (see docker/docker-entrypoint.sh) from the GEMINI_API_KEY environment variable.
#
# Portainer / compose: set GEMINI_API_KEY in stack env vars — no rebuild needed to rotate keys.
# Local compose: same — pass GEMINI_API_KEY in .env for the running container.
# Optional build-time key (build-arg or secret) still works as a fallback when runtime env is unset.
#
# Standalone:
#   docker build -t ghcr.io/um-lrc/hses .
#   docker run -e GEMINI_API_KEY=... -p 3000:80 ghcr.io/um-lrc/hses
FROM node:22-alpine AS builder
ARG GEMINI_API_KEY=""
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN --mount=type=secret,id=gemini_api_key,required=false \
    set -eu; \
    KEY=""; \
    DOTENV=""; \
    if [ -f /run/secrets/gemini_api_key ] && [ -s /run/secrets/gemini_api_key ]; then \
      DOTENV="$$(grep -E '^[[:space:]]*GEMINI_API_KEY[[:space:]]*=' /run/secrets/gemini_api_key 2>/dev/null | head -1 || true)"; \
    fi; \
    if [ -n "$$DOTENV" ]; then \
      KEY="$$(printf '%s\n' "$$DOTENV" | sed 's/^[[:space:]]*GEMINI_API_KEY[[:space:]]*=[[:space:]]*//' | tr -d '\r')"; \
      KEY="$${KEY#\"}"; KEY="$${KEY%\"}"; KEY="$${KEY#\'}"; KEY="$${KEY%\'}"; \
    elif [ -f /run/secrets/gemini_api_key ] && [ -s /run/secrets/gemini_api_key ]; then \
      KEY="$$(tr -d '\n\r' </run/secrets/gemini_api_key)"; \
    fi; \
    if [ -z "$$KEY" ]; then KEY="${GEMINI_API_KEY}"; fi; \
    printf "GEMINI_API_KEY=%s\n" "$$KEY" > .env.production

RUN npm run build

FROM nginx:1.27-alpine
RUN apk add --no-cache jq
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
COPY --from=builder /app/dist /usr/share/nginx/html
# Fallback on disk before entrypoint runs; entrypoint overwrites with the live key.
RUN printf '%s\n' 'window.__RUNTIME_CONFIG__={"GEMINI_API_KEY":"","API_KEY":""};' \
    > /usr/share/nginx/html/runtime-config.js \
    && chmod -R a+rX /usr/share/nginx/html

EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]
