#!/usr/bin/env bash
# Faktura installer (macOS / Linux). Wraps Docker.
#
#   curl -fsSL https://github.com/kvit-app/faktura/releases/latest/download/install.sh | bash
#   — or —  bash install.sh
#
# Idempotent: rerunning with the same directory keeps your data and only updates
# the configuration and the image. Updating never deletes data: the app copies the
# database to <dir>/data/backups/ before any schema migration.
#
# Non-interactive use (CI, scripts): set FAKTURA_NONINTERACTIVE=1 and provide
# FAKTURA_DIR, FAKTURA_PORT, APP_PASSWORD, API_TOKEN (or API_TOKEN=generate).
# Optional in both modes, kept across reruns once set in .env: FAKTURA_MCP_PORT (3333),
# FAKTURA_BIND (0.0.0.0; use 127.0.0.1 behind a reverse proxy), ADDRESS_HEADER and
# XFF_DEPTH (trusted proxy header for the login throttle), FAKTURA_IMAGE.
[ -n "${BASH_VERSION:-}" ] || { echo "Run this script with bash: bash install.sh" >&2; exit 1; }
set -euo pipefail

DEFAULT_IMAGE="__IMAGE__"
if [ "$DEFAULT_IMAGE" = "__IMAGE""__" ]; then DEFAULT_IMAGE="ghcr.io/kvit-app/faktura:latest"; fi

say()  { printf '%s\n' "$*"; }
err()  { printf 'Error: %s\n' "$*" >&2; }
line() { printf '\n%s\n' "────────────────────────────────────────────────────────────"; }

# Prompts read from the terminal even when the script itself arrives on stdin (curl | bash).
TTY=/dev/tty
if [ "${FAKTURA_NONINTERACTIVE:-}" = "1" ]; then
  TTY=""
elif ! { : </dev/tty; } 2>/dev/null; then
  TTY=""
  if [ -z "${APP_PASSWORD:-}" ]; then
    err "No terminal is available for the questions. Set FAKTURA_NONINTERACTIVE=1 and FAKTURA_DIR, FAKTURA_PORT, APP_PASSWORD, API_TOKEN in the environment."
    exit 1
  fi
fi

ask() { # ask VAR "Question" "default"
  local var="$1" q="$2" def="$3" ans=""
  if [ -z "$TTY" ]; then
    eval "ans=\"\${$var:-}\""
    [ -n "$ans" ] || ans="$def"
  else
    printf '%s [%s]: ' "$q" "$def" >"$TTY"
    IFS= read -r ans <"$TTY" || true
    [ -n "$ans" ] || ans="$def"
  fi
  printf -v "$var" '%s' "$ans"
}

ask_secret() { # ask_secret VAR "Question" keep-current(0|1)  (never echoed, never logged)
  local var="$1" q="$2" keep="$3" ans=""
  if [ -z "$TTY" ]; then
    eval "ans=\"\${$var:-}\""
  else
    if [ "$keep" = "1" ]; then printf '%s [Enter = keep current]: ' "$q" >"$TTY"; else printf '%s: ' "$q" >"$TTY"; fi
    IFS= read -r -s ans <"$TTY" || true
    printf '\n' >"$TTY"
  fi
  printf -v "$var" '%s' "$ans"
}

gen_secret() { # 48 hex characters from the OS random source
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 24; else od -An -N24 -tx1 /dev/urandom | tr -d ' \n'; fi
}

# .env values are single-quoted so compose takes them literally ($, #, spaces and " are safe). Compose's own
# escaping inside single quotes differs from the shell's, so ' and \ are simply not allowed in secrets (checked below).
env_quote() { printf "'%s'" "$1"; }
# Read KEY from .env, accepting quoted or bare values.
env_read() { # env_read KEY FILE
  local v
  v="$(sed -n "s/^$1=//p" "$2" | tail -1)"
  case "$v" in
    \'*\') v="${v#\'}"; v="${v%\'}";;
    \"*\") v="${v#\"}"; v="${v%\"}";;
  esac
  printf '%s' "$v"
}

# ---------------------------------------------------------------- 1. Docker
if ! command -v docker >/dev/null 2>&1; then
  err "Docker was not found. Install Docker Desktop (macOS) or Docker Engine (Linux) first:"
  err "  https://docs.docker.com/get-docker/"
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  err "The 'docker compose' plugin is missing. It ships with Docker Desktop; on Linux install docker-compose-plugin:"
  err "  https://docs.docker.com/compose/install/linux/"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  err "Docker is installed but not running (or your user may not access it). Start Docker and try again."
  exit 1
fi

line
say "Faktura — installation"
if [ -n "$TTY" ]; then say "Four questions. Enter keeps the value in brackets."; else say "Non-interactive mode: answers taken from the environment."; fi
line

# ---------------------------------------------------------------- 2. Questions
DEFAULT_DIR="${FAKTURA_DIR:-$HOME/faktura}"
ask FAKTURA_DIR "Directory for configuration and data" "$DEFAULT_DIR"
FAKTURA_DIR="${FAKTURA_DIR/#\~/$HOME}"
mkdir -p "$FAKTURA_DIR/data/backups"
ENV_FILE="$FAKTURA_DIR/.env"
COMPOSE_FILE="$FAKTURA_DIR/docker-compose.yml"

# Existing installation: reuse its values as defaults without ever printing the secrets.
CUR_PORT=""; CUR_PASSWORD=""; CUR_TOKEN=""; CUR_MCP_PORT=""; CUR_BIND=""; CUR_ADDRESS_HEADER=""; CUR_XFF_DEPTH=""; CUR_IMAGE=""; CUR_MCP_HOSTS=""
if [ -f "$ENV_FILE" ]; then
  CUR_MCP_HOSTS="$(env_read MCP_ALLOWED_HOSTS "$ENV_FILE")"
  CUR_PORT="$(env_read FAKTURA_PORT "$ENV_FILE")"
  CUR_PASSWORD="$(env_read APP_PASSWORD "$ENV_FILE")"
  CUR_TOKEN="$(env_read API_TOKEN "$ENV_FILE")"
  CUR_MCP_PORT="$(env_read FAKTURA_MCP_PORT "$ENV_FILE")"
  CUR_BIND="$(env_read FAKTURA_BIND "$ENV_FILE")"
  CUR_ADDRESS_HEADER="$(env_read ADDRESS_HEADER "$ENV_FILE")"
  CUR_XFF_DEPTH="$(env_read XFF_DEPTH "$ENV_FILE")"
  CUR_IMAGE="$(env_read FAKTURA_IMAGE "$ENV_FILE")"
  say "Existing installation found in $FAKTURA_DIR — this run updates it; data is kept."
fi
IMAGE="${FAKTURA_IMAGE:-${CUR_IMAGE:-$DEFAULT_IMAGE}}"

ask FAKTURA_PORT "Port for the web app" "${FAKTURA_PORT:-${CUR_PORT:-3000}}"
case "$FAKTURA_PORT" in ''|*[!0-9]*) err "Port must be a number"; exit 1;; esac

while :; do
  ask_secret APP_PASSWORD "App password (the one login; at least 8 characters)" "$([ -n "$CUR_PASSWORD" ] && echo 1 || echo 0)"
  [ -n "$APP_PASSWORD" ] || APP_PASSWORD="$CUR_PASSWORD"
  if [ "${#APP_PASSWORD}" -ge 8 ]; then break; fi
  if [ -z "$TTY" ]; then err "APP_PASSWORD must be at least 8 characters"; exit 1; fi
  say "At least 8 characters, please." >"$TTY"
done
case "$APP_PASSWORD" in *$'\n'*) err "The password cannot contain a line break"; exit 1;; esac
case "$APP_PASSWORD" in *[\'\\]*) err "The password cannot contain ' or \\ (every other character is fine)"; exit 1;; esac

ask_secret API_TOKEN "API token for AI/MCP access (Enter = generate one)" "$([ -n "$CUR_TOKEN" ] && echo 1 || echo 0)"
if [ -z "$API_TOKEN" ]; then API_TOKEN="${CUR_TOKEN:-generate}"; fi
TOKEN_GENERATED=0
if [ "$API_TOKEN" = "generate" ]; then API_TOKEN="$(gen_secret)"; TOKEN_GENERATED=1; fi
if [ "${#API_TOKEN}" -lt 16 ]; then err "API_TOKEN must be at least 16 characters"; exit 1; fi
case "$API_TOKEN" in *[[:space:]\'\"]*) err "The API token cannot contain spaces or quotes"; exit 1;; esac

MCP_PORT="${FAKTURA_MCP_PORT:-${CUR_MCP_PORT:-3333}}"
BIND="${FAKTURA_BIND:-${CUR_BIND:-0.0.0.0}}"
ADDRESS_HEADER_VAL="${ADDRESS_HEADER:-${CUR_ADDRESS_HEADER:-}}"
XFF_DEPTH_VAL="${XFF_DEPTH:-${CUR_XFF_DEPTH:-1}}"
MCP_HOSTS_VAL="${MCP_ALLOWED_HOSTS:-${CUR_MCP_HOSTS:-}}"
case "$BIND" in 0.0.0.0|''|::) HOST_FOR_URL="localhost";; *) HOST_FOR_URL="$BIND";; esac

# ---------------------------------------------------------------- 3. Write config (secrets only in .env, mode 600)
umask 077
{
  printf '# Faktura configuration. Keep this file private: it holds the login password and the API token.\n'
  printf '# Values are single-quoted so $ and # inside them are taken literally.\n'
  printf 'APP_PASSWORD=%s\n' "$(env_quote "$APP_PASSWORD")"
  printf 'API_TOKEN=%s\n' "$(env_quote "$API_TOKEN")"
  printf 'FAKTURA_PORT=%s\n' "$FAKTURA_PORT"
  printf 'FAKTURA_MCP_PORT=%s\n' "$MCP_PORT"
  printf 'FAKTURA_BIND=%s\n' "$BIND"
  printf 'ADDRESS_HEADER=%s\n' "$(env_quote "$ADDRESS_HEADER_VAL")"
  printf 'XFF_DEPTH=%s\n' "$XFF_DEPTH_VAL"
  printf 'MCP_ALLOWED_HOSTS=%s\n' "$(env_quote "$MCP_HOSTS_VAL")"
  printf 'FAKTURA_IMAGE=%s\n' "$(env_quote "$IMAGE")"
} >"$ENV_FILE"
chmod 600 "$ENV_FILE"
umask 022

cat >"$COMPOSE_FILE" <<'YAML'
# Written by install.sh. Rerun the installer to change settings. Everything adjustable lives in .env
# (FAKTURA_BIND, ADDRESS_HEADER, XFF_DEPTH, MCP_ALLOWED_HOSTS, ports, image); this file is rewritten on every run.
# The compose project is named after this directory, so two installs in different directories coexist.
services:
  app:
    image: ${FAKTURA_IMAGE}
    restart: unless-stopped
    ports:
      - "${FAKTURA_BIND}:${FAKTURA_PORT}:3000"
    environment:
      APP_PASSWORD: ${APP_PASSWORD}
      API_TOKEN: ${API_TOKEN}
      ADDRESS_HEADER: ${ADDRESS_HEADER}
      XFF_DEPTH: ${XFF_DEPTH}
      TZ: Europe/Copenhagen
    volumes:
      # The only state: the SQLite database and all PDFs/receipts. Back up this folder.
      - ./data:/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 5s
      start_period: 20s

  # AI access (MCP over HTTP). Published on localhost only: reach it through your VPN, never the open internet.
  mcp:
    image: ${FAKTURA_IMAGE}
    restart: unless-stopped
    command: ["node", "mcp/dist/http.js"]
    depends_on:
      app:
        condition: service_healthy
    ports:
      - "127.0.0.1:${FAKTURA_MCP_PORT}:3333"
    environment:
      FAKTURA_URL: http://app:3000
      FAKTURA_API_TOKEN: ${API_TOKEN}
      MCP_HOST: 0.0.0.0
      MCP_PORT: "3333"
      MCP_ALLOWED_HOSTS: localhost:${FAKTURA_MCP_PORT},127.0.0.1:${FAKTURA_MCP_PORT}${MCP_ALLOWED_HOSTS:+,}${MCP_ALLOWED_HOSTS:-}
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3333/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 5s
      start_period: 10s
YAML

# ---------------------------------------------------------------- 4. Pull and start
line
say "Starting Faktura ($IMAGE) on port $FAKTURA_PORT …"
cd "$FAKTURA_DIR"
if ! docker compose pull --quiet 2>/dev/null; then
  if docker image inspect "$IMAGE" >/dev/null 2>&1; then
    say "Could not pull $IMAGE; using the local copy."
  else
    err "Could not pull $IMAGE and no local copy exists. Check your network or FAKTURA_IMAGE."
    exit 1
  fi
fi
docker compose up -d --remove-orphans 2> >(grep -v 'No services to build' >&2)

# ---------------------------------------------------------------- 5. Health check
URL="http://$HOST_FOR_URL:$FAKTURA_PORT"
ok=0
for _ in $(seq 1 60); do
  if curl -fsS "$URL/healthz" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != "1" ]; then
  err "The app did not answer on $URL/healthz within 60 s. Logs: (cd \"$FAKTURA_DIR\" && docker compose logs)"
  exit 1
fi

# ---------------------------------------------------------------- 6. Summary (secrets stay in .env; a freshly generated token is shown once, on the terminal only)
line
say "Faktura is running."
say ""
say "  Open:        $URL"
say "  Log in with: the app password you chose"
say "  Data:        $FAKTURA_DIR/data   (app.db + files/ — back this folder up)"
say "  Config:      $ENV_FILE  (private; holds the secrets)"
say ""
say "AI / MCP access — the MCP server runs alongside the app on this machine only (localhost:$MCP_PORT)."
say "Put this in your MCP client config (Claude Code, Claude Desktop, …) on this machine or over your VPN:"
say ""
cat <<JSON
  { "mcpServers": { "kvit": { "type": "http", "url": "http://localhost:$MCP_PORT/mcp" } } }
JSON
say ""
say "For a client that only speaks stdio, this runs the MCP server inside the app container (the token is read"
say "from the container's own environment, so it appears nowhere in your client config):"
say ""
cat <<JSON
  { "mcpServers": { "kvit": { "command": "docker", "args": ["compose", "-f", "$COMPOSE_FILE", "exec", "-i", "-T",
      "-e", "FAKTURA_URL=http://127.0.0.1:3000", "app", "sh", "-c", "FAKTURA_API_TOKEN=\$API_TOKEN exec node mcp/dist/stdio.js"] } } }
JSON
say ""
if [ "$TOKEN_GENERATED" = "1" ] && [ -n "$TTY" ]; then
  say "A new API token was generated. It is stored in $ENV_FILE; shown here once, on the terminal only:" >"$TTY"
  printf '  API_TOKEN=%s\n\n' "$API_TOKEN" >"$TTY"
fi
say "Update later: rerun this installer with the same directory. Your data is kept, and the database is copied"
say "to $FAKTURA_DIR/data/backups/ before any schema change."
line
