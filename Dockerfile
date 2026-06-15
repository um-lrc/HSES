# syntax=docker/dockerfile:1
# Build static assets (API key is inlined at build time — see vite.config.ts).
#
# CI (GitHub Actions): GEMINI_API_KEY is passed as a build-arg from repository secrets.
# Local compose: BuildKit secret `gemini_api_key` from a dotenv file, or build-arg fallback.
# Portainer: pull a pre-built image from GHCR (see docker-compose.portainer.yml).
#
# Standalone:
#   docker build --build-arg GEMINI_API_KEY=... -t ghcr.io/um-lrc/hses .
#   docker build --secret id=gemini_api_key,src=.env -t ghcr.io/um-lrc/hses .
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
    if [ -z "$$KEY" ]; then \
      echo "ERROR: GEMINI_API_KEY is empty. For docker compose: add GEMINI_API_KEY=... to project .env (see .env.example) or set GEMINI_API_KEY_FILE. For docker build: --secret id=gemini_api_key,env=GEMINI_API_KEY or --build-arg GEMINI_API_KEY=..." >&2; \
      exit 1; \
    fi; \
    printf "GEMINI_API_KEY=%s\n" "$$KEY" > .env.production

RUN npm run build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
# dist may contain mode 600 assets from the builder; nginx workers run as non-root and need read + dir traverse.
RUN chmod -R a+rX /usr/share/nginx/html

EXPOSE 80
