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

# better-sqlite3 ships N-API prebuilds for linux-x64 and linux-arm64; --ignore-scripts
# skips its node-gyp fallback (no compiler in the image). Dev deps are needed for the
# build and pruned afterwards; NODE_ENV=production alone would skip them.
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund

# The MCP server (mcp/) is built into the same image and started as a second
# compose service: `node mcp/dist/http.js` (see install.sh / docker-compose.yml).
COPY mcp/package.json mcp/package-lock.json ./mcp/
RUN npm --prefix mcp ci --include=dev --ignore-scripts --no-audit --no-fund

COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund \
 && npm --prefix mcp run build && npm --prefix mcp prune --omit=dev --no-audit --no-fund

# The design authority files are asserted at startup and tokens.css is inlined
# into every generated PDF, so they ship with the image.
RUN test -f tokens.css && test -f style.md && test -f example.html && test -f mcp/dist/http.js

VOLUME ["/data"]
EXPOSE 3000 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "build"]
