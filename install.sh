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
# XFF_DEPTH (trusted proxy header for the login throttle), MCP_ALLOWED_HOSTS (extra
# host:port values the MCP endpoint may be addressed as), FAKTURA_IMAGE.
#
# Optional HTTPS (fifth question, default none), also kept across reruns:
#   FAKTURA_TLS=local      Caddy in compose with its own certificate authority for FAKTURA_DOMAIN
#                          (default kvit.localhost) on FAKTURA_TLS_PORT (443) and, for MCP, on
#                          FAKTURA_MCP_TLS_PORT (8443, localhost only). The root certificate is
#                          copied to <dir>/kvit-root-ca.crt. FAKTURA_TRUST_LOCAL=1 also adds the
#                          hosts entry and trusts the certificate on this machine (uses sudo).
#   FAKTURA_TLS=tailscale  `tailscale serve` publishes the app on https://<machine>.<tailnet>.ts.net
#                          (port 443) and the MCP endpoint on port 8443 with a real certificate,
#                          reachable from your tailnet only. Requires Tailscale with HTTPS enabled.
[ -n "${BASH_VERSION:-}" ] || { echo "Run this script with bash: bash install.sh" >&2; exit 1; }
set -euo pipefail

DEFAULT_IMAGE="__IMAGE__"
if [ "$DEFAULT_IMAGE" = "__IMAGE""__" ]; then DEFAULT_IMAGE="ghcr.io/kvit-app/faktura:latest"; fi
CADDY_IMAGE="caddy:2-alpine"

say()  { printf '%s\n' "$*"; }
err()  { printf 'Error: %s\n' "$*" >&2; }
warn() { printf 'Warning: %s\n' "$*" >&2; }
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

ask_yes_no() { # ask_yes_no VAR "Question" (default no). Non-interactive: VAR=1 means yes.
  local var="$1" q="$2" ans=""
  if [ -z "$TTY" ]; then
    eval "ans=\"\${$var:-}\""
    [ "$ans" = "1" ] && ans="y" || ans="n"
  else
    printf '%s [y/N]: ' "$q" >"$TTY"
    IFS= read -r ans <"$TTY" || true
  fi
  case "$ans" in y|Y|yes|YES|Yes) printf -v "$var" '%s' "1";; *) printf -v "$var" '%s' "0";; esac
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

# Tailscale CLI: FAKTURA_TAILSCALE_BIN if set, else on PATH, else inside the macOS app bundle.
find_tailscale() {
  if [ -n "${FAKTURA_TAILSCALE_BIN:-}" ]; then
    if [ -x "$FAKTURA_TAILSCALE_BIN" ]; then printf '%s' "$FAKTURA_TAILSCALE_BIN"; return 0; fi
    return 1
  fi
  if command -v tailscale >/dev/null 2>&1; then command -v tailscale; return 0; fi
  if [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then printf '%s' /Applications/Tailscale.app/Contents/MacOS/Tailscale; return 0; fi
  return 1
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
if [ -n "$TTY" ]; then say "Four questions plus an optional HTTPS choice. Enter keeps the value in brackets."; else say "Non-interactive mode: answers taken from the environment."; fi
line

# ---------------------------------------------------------------- 2. Questions
DEFAULT_DIR="${FAKTURA_DIR:-$HOME/faktura}"
ask FAKTURA_DIR "Directory for configuration and data" "$DEFAULT_DIR"
FAKTURA_DIR="${FAKTURA_DIR/#\~/$HOME}"
mkdir -p "$FAKTURA_DIR/data/backups"
ENV_FILE="$FAKTURA_DIR/.env"
COMPOSE_FILE="$FAKTURA_DIR/docker-compose.yml"
CADDYFILE="$FAKTURA_DIR/Caddyfile"
CA_FILE="$FAKTURA_DIR/kvit-root-ca.crt"

# Existing installation: reuse its values as defaults without ever printing the secrets.
CUR_PORT=""; CUR_PASSWORD=""; CUR_TOKEN=""; CUR_MCP_PORT=""; CUR_BIND=""; CUR_ADDRESS_HEADER=""; CUR_XFF_DEPTH=""; CUR_IMAGE=""; CUR_MCP_HOSTS=""
CUR_TLS=""; CUR_DOMAIN=""; CUR_TLS_PORT=""; CUR_MCP_TLS_PORT=""
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
  CUR_TLS="$(env_read FAKTURA_TLS "$ENV_FILE")"
  CUR_DOMAIN="$(env_read FAKTURA_DOMAIN "$ENV_FILE")"
  CUR_TLS_PORT="$(env_read FAKTURA_TLS_PORT "$ENV_FILE")"
  CUR_MCP_TLS_PORT="$(env_read FAKTURA_MCP_TLS_PORT "$ENV_FILE")"
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

# ---------------------------------------------------------------- 2b. HTTPS (optional)
ask FAKTURA_TLS "HTTPS: none, local (own certificate for a local domain) or tailscale (tailnet certificate)" "${FAKTURA_TLS:-${CUR_TLS:-none}}"
TLS="$(printf '%s' "$FAKTURA_TLS" | tr 'A-Z' 'a-z')"
case "$TLS" in none|local|tailscale) ;; *) err "FAKTURA_TLS must be none, local or tailscale (got \"$FAKTURA_TLS\")"; exit 1;; esac
DOMAIN=""; TLS_PORT=""; MCP_TLS_PORT=""; TS=""
if [ "$TLS" = "local" ]; then
  ask FAKTURA_DOMAIN "Local domain name for the certificate" "${FAKTURA_DOMAIN:-${CUR_DOMAIN:-kvit.localhost}}"
  DOMAIN="$(printf '%s' "$FAKTURA_DOMAIN" | tr 'A-Z' 'a-z')"
  case "$DOMAIN" in ''|*[!a-z0-9.-]*|.*|*.|*..*) err "The domain may only contain letters, digits, dots and dashes"; exit 1;; esac
  ask FAKTURA_TLS_PORT "HTTPS port for the web app" "${FAKTURA_TLS_PORT:-${CUR_TLS_PORT:-443}}"
  ask FAKTURA_MCP_TLS_PORT "HTTPS port for the MCP endpoint (localhost only)" "${FAKTURA_MCP_TLS_PORT:-${CUR_MCP_TLS_PORT:-8443}}"
  TLS_PORT="$FAKTURA_TLS_PORT"; MCP_TLS_PORT="$FAKTURA_MCP_TLS_PORT"
  for p in "$TLS_PORT" "$MCP_TLS_PORT"; do case "$p" in ''|*[!0-9]*) err "HTTPS ports must be numbers"; exit 1;; esac; done
  [ "$TLS_PORT" != "$MCP_TLS_PORT" ] || { err "The two HTTPS ports must differ"; exit 1; }
elif [ "$TLS" = "tailscale" ]; then
  if ! TS="$(find_tailscale)"; then
    err "FAKTURA_TLS=tailscale needs the Tailscale CLI on this machine (https://tailscale.com/download). Nothing was changed."
    exit 1
  fi
  STATUS_JSON="$("$TS" status --json 2>/dev/null || true)"
  # The first DNSName in the status document is this machine's (Self precedes Peer).
  # tr joins the JSON into one line, so sed prints at most once; no `head` here, which could close the pipe early (exit 141).
  DOMAIN="$(printf '%s' "$STATUS_JSON" | tr -d '\n' | sed -n 's/.*"Self": *{[^}]*"DNSName": *"\([^"]*\)".*/\1/p')"
  DOMAIN="${DOMAIN%.}"
  if [ -z "$DOMAIN" ]; then
    err "Tailscale is installed but not connected, or MagicDNS is off. Run 'tailscale up', enable MagicDNS and HTTPS in the admin console (DNS page), then rerun. Nothing was changed."
    exit 1
  fi
  TLS_PORT="${FAKTURA_TLS_PORT:-${CUR_TLS_PORT:-443}}"
  MCP_TLS_PORT="${FAKTURA_MCP_TLS_PORT:-${CUR_MCP_TLS_PORT:-8443}}"
  for p in "$TLS_PORT" "$MCP_TLS_PORT"; do case "$p" in 443|8443|10000) ;; *) err "Tailscale serve only offers HTTPS on ports 443, 8443 and 10000 (got $p)"; exit 1;; esac; done
  [ "$TLS_PORT" != "$MCP_TLS_PORT" ] || { err "The two HTTPS ports must differ"; exit 1; }
fi
# Host names the MCP endpoint may be addressed as through the TLS proxy (its DNS-rebinding check is strict).
MCP_TLS_HOSTS=""
if [ -n "$DOMAIN" ]; then MCP_TLS_HOSTS="$DOMAIN:$MCP_TLS_PORT,$DOMAIN"; fi
# Compose lets exported variables override .env, so the exported names must hold the normalised values.
FAKTURA_TLS="$TLS"; FAKTURA_DOMAIN="$DOMAIN"; FAKTURA_TLS_PORT="${TLS_PORT:-443}"; FAKTURA_MCP_TLS_PORT="${MCP_TLS_PORT:-8443}"
FAKTURA_MCP_PORT="$MCP_PORT"; FAKTURA_BIND="$BIND"; ADDRESS_HEADER="$ADDRESS_HEADER_VAL"; XFF_DEPTH="$XFF_DEPTH_VAL"
MCP_ALLOWED_HOSTS="$MCP_HOSTS_VAL"; FAKTURA_IMAGE="$IMAGE"

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
  printf '# HTTPS: none, local or tailscale (see the installer header). MCP_TLS_HOSTS is derived; do not edit.\n'
  printf 'FAKTURA_TLS=%s\n' "$TLS"
  printf 'FAKTURA_DOMAIN=%s\n' "$(env_quote "$DOMAIN")"
  printf 'FAKTURA_TLS_PORT=%s\n' "${TLS_PORT:-443}"
  printf 'FAKTURA_MCP_TLS_PORT=%s\n' "${MCP_TLS_PORT:-8443}"
  printf 'MCP_TLS_HOSTS=%s\n' "$(env_quote "$MCP_TLS_HOSTS")"
} >"$ENV_FILE"
chmod 600 "$ENV_FILE"
umask 022

cat >"$COMPOSE_FILE" <<'YAML'
# Written by install.sh. Rerun the installer to change settings. Everything adjustable lives in .env
# (FAKTURA_BIND, ADDRESS_HEADER, XFF_DEPTH, MCP_ALLOWED_HOSTS, FAKTURA_TLS, ports, image); this file is rewritten on every run.
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
      MCP_ALLOWED_HOSTS: localhost:${FAKTURA_MCP_PORT},127.0.0.1:${FAKTURA_MCP_PORT}${MCP_TLS_HOSTS:+,}${MCP_TLS_HOSTS:-}${MCP_ALLOWED_HOSTS:+,}${MCP_ALLOWED_HOSTS:-}
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3333/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 5s
      start_period: 10s
YAML

if [ "$TLS" = "local" ]; then
  cat >>"$COMPOSE_FILE" <<YAML

  # HTTPS with Caddy's own certificate authority (FAKTURA_TLS=local). The root certificate is copied to
  # kvit-root-ca.crt next to this file; trust it on every device that should open https://${DOMAIN}.
  # The MCP port stays on localhost, exactly like the plain one above.
  caddy:
    image: $CADDY_IMAGE
    restart: unless-stopped
    depends_on:
      - app
      - mcp
    ports:
      - "\${FAKTURA_BIND}:\${FAKTURA_TLS_PORT}:\${FAKTURA_TLS_PORT}"
      - "127.0.0.1:\${FAKTURA_MCP_TLS_PORT}:\${FAKTURA_MCP_TLS_PORT}"
    environment:
      FAKTURA_DOMAIN: \${FAKTURA_DOMAIN}
      FAKTURA_TLS_PORT: \${FAKTURA_TLS_PORT}
      FAKTURA_MCP_TLS_PORT: \${FAKTURA_MCP_TLS_PORT}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./caddy:/data
YAML
  cat >"$CADDYFILE" <<'CADDY'
# Written by install.sh for FAKTURA_TLS=local. Certificates come from Caddy's internal CA (root in ./caddy/pki/,
# copied to ./kvit-root-ca.crt). Host headers pass through unchanged, which the app's CSRF check and the MCP
# endpoint's host check both rely on.
{
	skip_install_trust
	auto_https disable_redirects
}

https://{$FAKTURA_DOMAIN}:{$FAKTURA_TLS_PORT} {
	tls internal
	encode zstd gzip
	reverse_proxy app:3000
}

https://{$FAKTURA_DOMAIN}:{$FAKTURA_MCP_TLS_PORT} {
	tls internal
	reverse_proxy mcp:3333
}
CADDY
else
  rm -f "$CADDYFILE"
fi

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

# ---------------------------------------------------------------- 5b. HTTPS setup
TLS_URL=""; MCP_URL="http://localhost:$MCP_PORT/mcp"; TRUST_DONE=0
if [ "$TLS" = "local" ]; then
  TLS_URL="https://$DOMAIN:$TLS_PORT"; MCP_URL="https://$DOMAIN:$MCP_TLS_PORT/mcp"
  say "Waiting for the local certificate authority …"
  ok=0
  for _ in $(seq 1 30); do
    # Read through exec rather than cp: no host path handling, and no root-owned file to fix up afterwards.
    if docker compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt >"$CA_FILE" 2>/dev/null && grep -q 'BEGIN CERTIFICATE' "$CA_FILE"; then ok=1; break; fi
    sleep 1
  done
  if [ "$ok" != "1" ]; then
    err "Caddy did not produce a root certificate within 30 s. Logs: (cd \"$FAKTURA_DIR\" && docker compose logs caddy)"
    exit 1
  fi
  chmod 644 "$CA_FILE"
  ok=0
  for _ in $(seq 1 30); do
    if curl -fsS --cacert "$CA_FILE" --resolve "$DOMAIN:$TLS_PORT:127.0.0.1" "$TLS_URL/healthz" >/dev/null 2>&1; then ok=1; break; fi
    sleep 1
  done
  if [ "$ok" != "1" ]; then
    err "The app did not answer over HTTPS on $TLS_URL within 30 s. Is port $TLS_PORT free? Logs: (cd \"$FAKTURA_DIR\" && docker compose logs caddy)"
    exit 1
  fi

  ask_yes_no FAKTURA_TRUST_LOCAL "Add '127.0.0.1 $DOMAIN' to /etc/hosts and trust the certificate on this machine now? (uses sudo)"
  if [ "$FAKTURA_TRUST_LOCAL" = "1" ]; then
    if grep -Eq "^[^#]*[[:space:]]$DOMAIN([[:space:]]|\$)" /etc/hosts 2>/dev/null; then
      say "/etc/hosts already has $DOMAIN."
    elif printf '127.0.0.1 %s\n' "$DOMAIN" | sudo tee -a /etc/hosts >/dev/null; then
      say "Added 127.0.0.1 $DOMAIN to /etc/hosts."
    else
      warn "Could not write /etc/hosts; add this line yourself:  127.0.0.1 $DOMAIN"
    fi
    if [ "$(uname -s)" = "Darwin" ]; then
      if sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CA_FILE"; then TRUST_DONE=1; fi
    elif [ -d /usr/local/share/ca-certificates ] && command -v update-ca-certificates >/dev/null 2>&1; then
      if sudo cp "$CA_FILE" /usr/local/share/ca-certificates/kvit-local-ca.crt && sudo update-ca-certificates >/dev/null; then TRUST_DONE=1; fi
    elif [ -d /etc/pki/ca-trust/source/anchors ] && command -v update-ca-trust >/dev/null 2>&1; then
      if sudo cp "$CA_FILE" /etc/pki/ca-trust/source/anchors/kvit-local-ca.crt && sudo update-ca-trust; then TRUST_DONE=1; fi
    else
      warn "No known certificate store on this system; import $CA_FILE as a trusted root by hand."
    fi
    [ "$TRUST_DONE" = "1" ] && say "The certificate is trusted by this machine's system store (browsers, Claude Desktop). Restart open browsers."
  fi
elif [ "$TLS" = "tailscale" ]; then
  TLS_URL="https://$DOMAIN$([ "$TLS_PORT" = "443" ] || printf ':%s' "$TLS_PORT")"; MCP_URL="https://$DOMAIN:$MCP_TLS_PORT/mcp"
  say "Publishing on your tailnet with tailscale serve …"
  if ! "$TS" serve --bg --https="$TLS_PORT" "http://127.0.0.1:$FAKTURA_PORT" >/dev/null; then
    err "tailscale serve failed for the app. HTTPS certificates must be enabled for the tailnet (admin console → DNS → HTTPS Certificates); the command may need sudo on Linux. Faktura itself is running on $URL."
    exit 1
  fi
  if ! "$TS" serve --bg --https="$MCP_TLS_PORT" "http://127.0.0.1:$MCP_PORT" >/dev/null; then
    err "tailscale serve failed for the MCP endpoint (port $MCP_TLS_PORT). The app is published on $TLS_URL."
    exit 1
  fi
  ok=0
  for _ in $(seq 1 60); do
    if curl -fsS "$TLS_URL/healthz" >/dev/null 2>&1; then ok=1; break; fi
    sleep 1
  done
  [ "$ok" = "1" ] || warn "$TLS_URL/healthz did not answer yet; the first certificate can take a minute. Check 'tailscale serve status'."
fi
# Switching away from tailscale: take the old mounts down again (best effort).
if [ "$CUR_TLS" = "tailscale" ] && [ "$TLS" != "tailscale" ] && TS_OLD="$(find_tailscale)"; then
  "$TS_OLD" serve --https="${CUR_TLS_PORT:-443}" off >/dev/null 2>&1 || true
  "$TS_OLD" serve --https="${CUR_MCP_TLS_PORT:-8443}" off >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------- 6. Summary (secrets stay in .env; a freshly generated token is shown once, on the terminal only)
line
say "Faktura is running."
say ""
say "  Open:        $URL"
[ -n "$TLS_URL" ] && say "  HTTPS:       $TLS_URL"
say "  Log in with: the app password you chose"
say "  Data:        $FAKTURA_DIR/data   (app.db + files/ — back this folder up)"
say "  Config:      $ENV_FILE  (private; holds the secrets)"
say ""
case "$TLS" in
  local)
    say "HTTPS uses a certificate authority created on this machine. Its root certificate is $CA_FILE."
    if [ "$FAKTURA_TRUST_LOCAL" != "1" ] || [ "$TRUST_DONE" != "1" ]; then
      say "To make browsers and Claude Desktop accept it: add '127.0.0.1 $DOMAIN' to /etc/hosts and import that file as a"
      say "trusted root (rerun the installer and answer yes to do both), or copy it to another device and trust it there."
    fi
    say "Claude Code (Node) does not read the system store: start it with NODE_EXTRA_CA_CERTS=$CA_FILE"
    say ""
    say "AI / MCP access — the MCP endpoint is on this machine only: $MCP_URL (also http://localhost:$MCP_PORT/mcp)."
    ;;
  tailscale)
    say "HTTPS is served by Tailscale with a real certificate, reachable from devices on your tailnet only."
    say "'tailscale serve status' shows the mounts; 'tailscale serve --https=$TLS_PORT off' removes one."
    say ""
    say "AI / MCP access — the MCP endpoint is reachable from every device on your tailnet: $MCP_URL"
    say "(it has no login of its own: whoever is on the tailnet can use every tool, including the write tools)."
    ;;
  *)
    say "AI / MCP access — the MCP server runs alongside the app on this machine only (localhost:$MCP_PORT)."
    ;;
esac
say "Put this in your MCP client config (Claude Code, Claude Desktop, …):"
say ""
cat <<JSON
  { "mcpServers": { "kvit": { "type": "http", "url": "$MCP_URL" } } }
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
