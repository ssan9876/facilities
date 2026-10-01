#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
archive=${1:?Pass the GitHub release archive}
work=$(mktemp -d)
name="facilities-release-smoke-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf -- "$work"; }
trap cleanup EXIT
# Exercise the original installer extraction path, including its private umask.
# This deliberately leaves data-filter directory permissions untouched so the
# image's non-root static-file handling is tested independently of the updater.
python3 - "$archive" "$work" <<'PY'
import sys,tarfile
with tarfile.open(sys.argv[1]) as archive:
    archive.extractall(sys.argv[2],filter='data')
PY
docker build -t facilities:smoke "$work/facilities"
docker run -d --name "$name" --network host \
  -e PORT=3100 -e NODE_ENV=production -e AUTH_MODE=oidc \
  -e APP_URL=https://facilities.example.test \
  -e SESSION_SECRET=release-smoke-only-not-a-real-deployment-secret \
  -e OIDC_ISSUER=https://idp.example.test -e OIDC_CLIENT_ID=smoke -e OIDC_CLIENT_SECRET=smoke \
  -e DATABASE_URL="${TEST_DATABASE_URL:?Use the disposable CI database}" facilities:smoke
healthy=0
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3100/health >/dev/null; then healthy=1; break; fi
  sleep 1
done
if [[ $healthy != 1 ]]; then docker logs "$name"; exit 1; fi
for path in / /app.js /ui.js /hooks.js /forms.js /order.js /records.js /inventory.js /reports.js /audit.js /styles.css /request-settings.js /admin-settings.js /fonts/manrope-latin.woff2; do
  curl -fsS -H 'Host: facilities.example.test' "http://127.0.0.1:3100$path" -o "$work/response"
  test -s "$work/response"
done
echo 'Release archive: non-root HTML, JavaScript, CSS and font delivery verified.'
