#!/usr/bin/env bash
# Definition of done 2: the linux-x64 binary starts on a clean container WITHOUT Node,
# completes the (non-interactive) wizard and serves the app. Chromium download is
# skipped here (network + 150 MB); the app must still serve pages and /healthz.
set -euo pipefail
cd "$(dirname "$0")/../.."

BIN="$(ls dist/faktura-linux-x64-* 2>/dev/null | head -1)"
[ -n "$BIN" ] || { echo "no linux-x64 binary in dist/ (run: node packaging/build-binaries.mjs --targets linux-x64)"; exit 1; }
PORT="${TEST_PORT:-3781}"
NAME="faktura-binary-smoke-$$"
# Git Bash on Windows rewrites /container/paths in arguments; docker gets them verbatim through dk.
dk() { MSYS_NO_PATHCONV=1 docker "$@"; }

cleanup() { dk rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== start $BIN in ubuntu:24.04 (no node) on :$PORT"
dk run -d --name "$NAME" -p "127.0.0.1:$PORT:$PORT" \
  -v "$(pwd)/dist:/dist:ro" \
  -e FAKTURA_NONINTERACTIVE=1 -e FAKTURA_DIR=/srv/faktura -e FAKTURA_PORT="$PORT" -e FAKTURA_HOST=0.0.0.0 \
  -e APP_PASSWORD=binary-smoke-password -e API_TOKEN=generate -e FAKTURA_SKIP_CHROMIUM=1 \
  ubuntu:24.04 bash -c "command -v node && exit 99; cp /dist/$(basename "$BIN") /usr/local/bin/faktura && chmod +x /usr/local/bin/faktura && exec faktura" >/dev/null

ok=0
for _ in $(seq 1 90); do
  # grep -c reads to EOF; grep -q would close the pipe early and turn curl's SIGPIPE into exit 141 under pipefail.
  if curl -fsS "http://127.0.0.1:$PORT/healthz" 2>/dev/null | grep -c '"ok":true' >/dev/null; then ok=1; break; fi
  if [ "$(dk inspect -f '{{.State.Running}}' "$NAME")" != "true" ]; then break; fi
  sleep 1
done
if [ "$ok" != "1" ]; then
  echo "FAIL: binary did not serve /healthz"; dk logs "$NAME" | tail -40; exit 1
fi

echo "== wizard output and config"
# Capture the log once: `docker logs | grep -q` dies with SIGPIPE (exit 141) as soon as grep has its match.
LOGS="$(dk logs "$NAME" 2>&1)"
grep -q "Faktura .* is running" <<<"$LOGS" || { echo "FAIL: launcher did not report the app running"; printf '%s\n' "$LOGS" | tail -40; exit 1; }
dk exec "$NAME" test -f /srv/faktura/faktura.config.json
dk exec "$NAME" test -f /srv/faktura/data/app.db
if grep -q "binary-smoke-password" <<<"$LOGS"; then echo "FAIL: password echoed"; exit 1; fi

echo "== login"
HDR="$(mktemp)"
curl -s -D "$HDR" -o "$HDR.body" -X POST -H "Origin: http://127.0.0.1:$PORT" --data-urlencode "password=binary-smoke-password" "http://127.0.0.1:$PORT/login" || true
hdrs="$(cat "$HDR")"; rm -f "$HDR" "$HDR.body"
echo "$hdrs" | grep -qi "set-cookie: faktura_session=" || { echo "FAIL: login did not set a session"; echo "$hdrs"; exit 1; }

echo "== issuing is refused while Chromium is absent"
TOKEN="$(dk exec "$NAME" sh -c "grep -o '\"apiToken\": *\"[^\"]*\"' /srv/faktura/faktura.config.json | cut -d'\"' -f4")"
CID="$(curl -fsS -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"name":"K","address":"A","zip":"1000","city":"B","email":""}' "http://127.0.0.1:$PORT/api/customers" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)"
DID="$(curl -fsS -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"customerId\":$CID}" "http://127.0.0.1:$PORT/api/invoices" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)"
resp="$(curl -s -H "Authorization: Bearer $TOKEN" -X POST "http://127.0.0.1:$PORT/api/invoices/$DID/issue")"
echo "$resp" | grep -q "Chromium" || { echo "FAIL: issue was not refused for missing Chromium: $resp"; exit 1; }

echo "OK: binary smoke test passed"
