# Playwright's image carries the Chromium build matching the pinned playwright
# npm version (1.63.0) plus Node.js, so PDF generation works without extra setup.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    PROJECT_ROOT=/app \
    BODY_SIZE_LIMIT=20M

WORKDIR /app

# Native module (better-sqlite3) compiles against this image's Node ABI.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# The design authority files are asserted at startup and tokens.css is inlined
# into every generated PDF, so they ship with the image.
RUN test -f tokens.css && test -f style.md && test -f example.html

VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "build"]
