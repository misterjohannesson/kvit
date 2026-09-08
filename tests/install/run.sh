#!/usr/bin/env bash
# Installer smoke test (definition of done 1, 6 and 9). Needs Docker and bash; runs on a
# CI runner or a developer machine, never inside `npm test`.
#
#   1. builds the image locally and tags it as the installer's default image
#   2. serves dist/ (or the repo root) over HTTP and runs `curl -fsSL .../install.sh | bash`
#      non-interactively into a temp directory
#   3. checks /healthz, logs in with the chosen password, creates a customer via the API
#   4. reruns the installer with the same directory: data and token unchanged
#   5. reruns with FAKTURA_TLS=local: certificate verifies against the copied root, login and the
#      MCP initialize handshake work through the proxy, the MCP TLS port stays on loopback
#   6. FAKTURA_TLS=tailscale without the CLI is refused before anything is written
#   7. greps the captured installer output for the password and the token (must be absent)
#   8. tears everything down
set -euo pipefail
cd "$(dirname "$0")/../.."

IMAGE="${FAKTURA_IMAGE:-ghcr.io/kvit-app/faktura:latest}"
PORT="${TEST_PORT:-3651}"
MCP_PORT="${TEST_MCP_PORT:-3652}"
FILE_PORT="${TEST_FILE_PORT:-8765}"
WORK="$(mktemp -d)"
PASSWORD="smoke-$RANDOM-"'pa$$word "q" #not-a-comment'   # $$, a double quote and " #" must survive compose interpolation
SERVE_DIR="${SERVE_DIR:-dist}"
[ -f "$SERVE_DIR/install.sh" ] || SERVE_DIR="."

cleanup() {
  set +e
  [ -n "${FILE_PID:-}" ] && kill "$FILE_PID" 2>/dev/null
  if [ -f "$WORK/inst/docker-compose.yml" ]; then (cd "$WORK/inst" && docker compose down --remove-orphans >/dev/null 2>&1); fi
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "== build image $IMAGE"
docker build -q -t "$IMAGE" . >/dev/null

echo "== serve $SERVE_DIR on :$FILE_PORT"
node tests/install/serve.mjs "$SERVE_DIR" "$FILE_PORT" >/dev/null 2>&1 &
FILE_PID=$!
sleep 1

export FAKTURA_NONINTERACTIVE=1 FAKTURA_DIR="$WORK/inst" FAKTURA_PORT="$PORT" FAKTURA_MCP_PORT="$MCP_PORT" APP_PASSWORD="$PASSWORD" API_TOKEN=generate FAKTURA_IMAGE="$IMAGE"

echo "== curl | bash"
curl -fsSL "http://127.0.0.1:$FILE_PORT/install.sh" | bash >"$WORK/run1.out" 2>&1
# .env values are single-quoted by the installer
TOKEN="$(sed -n "s/^API_TOKEN='\(.*\)'\$/\1/p" "$WORK/inst/.env")"
[ "${#TOKEN}" -ge 16 ] || { echo "FAIL: no token written"; cat "$WORK/run1.out"; exit 1; }

echo "== health + login"
curl -fsS "http://127.0.0.1:$PORT/healthz" | grep -c '"ok":true' >/dev/null
hdrs="$(curl -s -D - -o /dev/null -X POST -H "Origin: http://127.0.0.1:$PORT" --data-urlencode "password=$PASSWORD" "http://127.0.0.1:$PORT/login")"
echo "$hdrs" | grep -qi "set-cookie: faktura_session=" || { echo "FAIL: login did not set a session"; exit 1; }
hdrs="$(curl -s -D - -o /dev/null -X POST -H "Origin: http://127.0.0.1:$PORT" --data-urlencode "password=wrong-$PASSWORD" "http://127.0.0.1:$PORT/login")"
if echo "$hdrs" | grep -qi "set-cookie: faktura_session="; then echo "FAIL: wrong password accepted"; exit 1; fi
curl -fsS -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"name":"Smoke ApS","address":"Vej 1","zip":"1000","city":"K","email":""}' "http://127.0.0.1:$PORT/api/customers" >/dev/null
AUDIT1="$(curl -fsS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/api/audit?limit=1")"

echo "== rerun (idempotent)"
API_TOKEN= APP_PASSWORD= bash "$SERVE_DIR/install.sh" >"$WORK/run2.out" 2>&1
TOKEN2="$(sed -n "s/^API_TOKEN='\(.*\)'\$/\1/p" "$WORK/inst/.env")"
[ "$TOKEN" = "$TOKEN2" ] || { echo "FAIL: token changed on rerun"; exit 1; }
sleep 3
curl -fsS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/api/customers" | grep -c 'Smoke ApS' >/dev/null || { echo "FAIL: data lost on rerun"; exit 1; }
AUDIT2="$(curl -fsS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/api/audit?limit=1")"
[ "$AUDIT1" = "$AUDIT2" ] || { echo "FAIL: rerun wrote to the database"; exit 1; }

echo "== MCP endpoint"
curl -fsS "http://127.0.0.1:$MCP_PORT/healthz" | grep -c '"token_configured":true' >/dev/null

echo "== rerun with FAKTURA_TLS=local (Caddy, own CA, no changes to this machine)"
TLS_PORT="${TEST_TLS_PORT:-3653}"; MCP_TLS_PORT="${TEST_MCP_TLS_PORT:-3654}"; DOMAIN="kvit.localhost"
API_TOKEN= APP_PASSWORD= FAKTURA_TLS=local FAKTURA_DOMAIN="$DOMAIN" FAKTURA_TLS_PORT="$TLS_PORT" FAKTURA_MCP_TLS_PORT="$MCP_TLS_PORT" \
  bash "$SERVE_DIR/install.sh" >"$WORK/run3.out" 2>&1 || { echo "FAIL: TLS install failed"; cat "$WORK/run3.out"; exit 1; }
CA="$WORK/inst/kvit-root-ca.crt"
[ -s "$CA" ] || { echo "FAIL: no root certificate copied"; exit 1; }
grep -q "^FAKTURA_TLS=local$" "$WORK/inst/.env" || { echo "FAIL: FAKTURA_TLS not persisted"; exit 1; }
grep -q "^MCP_TLS_HOSTS='$DOMAIN:$MCP_TLS_PORT,$DOMAIN'$" "$WORK/inst/.env" || { echo "FAIL: MCP_TLS_HOSTS wrong"; cat "$WORK/inst/.env" | grep -v 'PASSWORD\|TOKEN'; exit 1; }
R="--cacert $CA --resolve $DOMAIN:$TLS_PORT:127.0.0.1 --resolve $DOMAIN:$MCP_TLS_PORT:127.0.0.1"
# The certificate must verify against the copied root (no -k anywhere), and the app must be reachable over it.
curl -fsS $R "https://$DOMAIN:$TLS_PORT/healthz" | grep -c '"ok":true' >/dev/null || { echo "FAIL: app not reachable over https"; exit 1; }
# Login through the proxy: the host-relative Origin check must pass with the https origin.
hdrs="$(curl -s $R -D - -o /dev/null -X POST -H "Origin: https://$DOMAIN:$TLS_PORT" --data-urlencode "password=$PASSWORD" "https://$DOMAIN:$TLS_PORT/login")"
echo "$hdrs" | grep -qi "set-cookie: faktura_session=" || { echo "FAIL: login over https did not set a session"; echo "$hdrs"; exit 1; }
# MCP over https: health, then a real initialize handshake (proves the Host check accepts the domain).
curl -fsS $R "https://$DOMAIN:$MCP_TLS_PORT/healthz" | grep -c '"token_configured":true' >/dev/null || { echo "FAIL: MCP not reachable over https"; exit 1; }
init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
curl -fsS --max-time 15 $R -X POST -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d "$init" "https://$DOMAIN:$MCP_TLS_PORT/mcp" \
  | grep -c '"serverInfo"' >/dev/null || { echo "FAIL: MCP initialize over https failed"; exit 1; }
# The plain ports still work, the MCP TLS port is on loopback only, and data survived the third run.
curl -fsS "http://127.0.0.1:$PORT/healthz" | grep -c '"ok":true' >/dev/null
(cd "$WORK/inst" && docker compose port caddy "$MCP_TLS_PORT") | grep -q "^127.0.0.1:$MCP_TLS_PORT$" || { echo "FAIL: MCP TLS port not bound to loopback"; exit 1; }
curl -fsS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/api/customers" | grep -c 'Smoke ApS' >/dev/null || { echo "FAIL: data lost on TLS rerun"; exit 1; }
grep -q "https://$DOMAIN:$MCP_TLS_PORT/mcp" "$WORK/run3.out" || { echo "FAIL: summary lacks the https MCP url"; exit 1; }

echo "== FAKTURA_TLS=tailscale without the CLI refuses before touching anything"
cp "$WORK/inst/.env" "$WORK/env.before"
if FAKTURA_TAILSCALE_BIN=/nonexistent/tailscale API_TOKEN= APP_PASSWORD= FAKTURA_TLS=tailscale bash "$SERVE_DIR/install.sh" >"$WORK/run4.out" 2>&1; then
  echo "FAIL: tailscale mode should fail without the CLI"; exit 1
else
  grep -q "needs the Tailscale CLI" "$WORK/run4.out" || { echo "FAIL: wrong error for missing tailscale"; cat "$WORK/run4.out"; exit 1; }
  cmp -s "$WORK/inst/.env" "$WORK/env.before" || { echo "FAIL: .env changed by the refused run"; exit 1; }
fi

echo "== secrets never in output"
if grep -qF -- "$PASSWORD" "$WORK/run1.out" "$WORK/run2.out" "$WORK/run3.out" "$WORK/run4.out"; then echo "FAIL: password echoed"; exit 1; fi
if grep -qF -- "$TOKEN" "$WORK/run1.out" "$WORK/run2.out" "$WORK/run3.out" "$WORK/run4.out"; then echo "FAIL: token echoed"; exit 1; fi
if ! grep -q "Faktura is running" "$WORK/run1.out"; then echo "FAIL: installer did not finish"; cat "$WORK/run1.out"; exit 1; fi

echo "OK: installer smoke test passed"
