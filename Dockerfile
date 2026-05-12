# syntax=docker/dockerfile:1
# Build static assets (API key is inlined at build time — see vite.config.ts).
# Uses a BuildKit secret so the key is not expanded into build logs (unlike ARG).
# Standalone: docker build --secret id=gemini_api_key,env=GEMINI_API_KEY -t hses-web .
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN --mount=type=secret,id=gemini_api_key \
    GEMINI_API_KEY="$(tr -d '\n\r' </run/secrets/gemini_api_key)" \
    && test -n "$GEMINI_API_KEY" \
    || (echo "ERROR: Build secret gemini_api_key is empty. Set GEMINI_API_KEY (e.g. docker compose --env-file .env.local build)." >&2 && exit 1) \
    && printf 'GEMINI_API_KEY=%s\n' "$GEMINI_API_KEY" > .env.production

RUN npm run build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
# dist may contain mode 600 assets from the builder; nginx workers run as non-root and need read + dir traverse.
RUN chmod -R a+rX /usr/share/nginx/html

EXPOSE 80
