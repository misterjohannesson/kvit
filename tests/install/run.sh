#!/usr/bin/env bash
# Installer smoke test (definition of done 1, 6 and 9). Needs Docker and bash; runs on a
# CI runner or a developer machine, never inside `npm test`.
#
#   1. builds the image locally and tags it as the installer's default image
#   2. serves dist/ (or the repo root) over HTTP and runs `curl -fsSL .../install.sh | bash`
#      non-interactively into a temp directory
#   3. checks /healthz, logs in with the chosen password, creates a customer via the API
#   4. reruns the installer with the same directory: data and token unchanged
#   5. greps the captured installer output for the password and the token (must be absent)
#   6. tears everything down
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
  if [ -f "$WORK/inst/docker-compose.yml" ]; then docker compose -f "$WORK/inst/docker-compose.yml" down --remove-orphans >/dev/null 2>&1; fi
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
curl -fsS "http://127.0.0.1:$PORT/healthz" | grep -q '"ok":true'
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
curl -fsS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/api/customers" | grep -q 'Smoke ApS' || { echo "FAIL: data lost on rerun"; exit 1; }
AUDIT2="$(curl -fsS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/api/audit?limit=1")"
[ "$AUDIT1" = "$AUDIT2" ] || { echo "FAIL: rerun wrote to the database"; exit 1; }

echo "== MCP endpoint"
curl -fsS "http://127.0.0.1:$MCP_PORT/healthz" | grep -q '"token_configured":true'

echo "== secrets never in output"
if grep -qF -- "$PASSWORD" "$WORK/run1.out" "$WORK/run2.out"; then echo "FAIL: password echoed"; exit 1; fi
if grep -qF -- "$TOKEN" "$WORK/run1.out" "$WORK/run2.out"; then echo "FAIL: token echoed"; exit 1; fi
if ! grep -q "Faktura is running" "$WORK/run1.out"; then echo "FAIL: installer did not finish"; cat "$WORK/run1.out"; exit 1; fi

echo "OK: installer smoke test passed"
