# Playwright's image carries the Chromium build matching the pinned playwright
# npm version (1.63.0) plus Node.js, so PDF generation works without extra setup.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    PROJECT_ROOT=/app \
    BODY_SIZE_LIMIT=25M

WORKDIR /app

# better-sqlite3 ships N-API prebuilds for linux-x64; --ignore-scripts skips its
# node-gyp fallback (no compiler in the image). Dev deps are needed for the build
# and pruned afterwards; NODE_ENV=production alone would skip them.
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund

COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# The design authority files are asserted at startup and tokens.css is inlined
# into every generated PDF, so they ship with the image.
RUN test -f tokens.css && test -f style.md && test -f example.html

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "build"]
