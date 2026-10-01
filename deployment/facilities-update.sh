#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT=${FACILITIES_HOME:-/opt/facilities}
REPO=${FACILITIES_REPOSITORY:-ssan9876/go-fmx-clone}
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo 'Invalid repository'; exit 1; }
[[ $EUID == 0 ]] || { echo 'Run with sudo.'; exit 1; }
mkdir -p "$ROOT"/releases "$ROOT"/backups "$ROOT"/bin
exec 9>"$ROOT/update.lock"
flock -n 9 || { echo 'Another update is running.'; exit 1; }
curl_https() { curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --retry 3 --connect-timeout 15 "$@"; }
version=${1:---check}
if [[ "$version" == --latest || "$version" == --check ]]; then
  latest=$(curl_https "https://api.github.com/repos/$REPO/releases/latest" | python3 -c 'import json,sys; r=json.load(sys.stdin); assert not r["draft"] and not r["prerelease"]; print(r["tag_name"])')
  if [[ "$version" == --check ]]; then
    echo "Installed: $(cat "$ROOT/current/package.json" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])' 2>/dev/null || echo none)"
    echo "Latest: $latest"
    exit 0
  fi
  version=$latest
fi
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Use --check, --latest, or vMAJOR.MINOR.PATCH.'; exit 1; }
[[ -f "$ROOT/.env" ]] || { echo "Configure $ROOT/.env first (mode 600)."; exit 1; }
chmod 600 "$ROOT/.env"
previous=$(readlink -f "$ROOT/current" || true)
target="$ROOT/releases/$version"
[[ "$previous" != "$target" ]] || { echo "$version is already installed."; exit 0; }
work=$(mktemp -d "$ROOT/.download.XXXXXX")
trap 'rm -rf -- "$work"' EXIT
curl_https "https://github.com/$REPO/releases/download/$version/facilities.tar.gz" -o "$work/facilities.tar.gz"
curl_https "https://github.com/$REPO/releases/download/$version/SHA256SUMS" -o "$work/SHA256SUMS"
python3 - "$work/SHA256SUMS" <<'PY'
import re,sys
assert re.fullmatch(r'[a-f0-9]{64}  facilities\.tar\.gz\n?',open(sys.argv[1]).read()), 'Invalid checksum manifest'
PY
(cd "$work"; sha256sum --check --strict SHA256SUMS)
python3 - "$work/facilities.tar.gz" "$work" <<'PY'
import pathlib,sys,tarfile
with tarfile.open(sys.argv[1]) as archive:
    for m in archive.getmembers():
        p=pathlib.PurePosixPath(m.name)
        assert p.parts and p.parts[0]=='facilities' and '..' not in p.parts and not p.is_absolute()
        assert m.isfile() or m.isdir(), 'Links and special files are not accepted'
    archive.extractall(sys.argv[2],filter='data')
PY
test "v$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$work/facilities/package.json")" = "$version"
if [[ -e "$target" ]]; then
  cmp "$work/SHA256SUMS" "$target/.release-checksum" || { echo 'Existing release directory has a different checksum. Inspect it before retrying.'; exit 1; }
else
  mv "$work/facilities" "$target"
  cp "$work/SHA256SUMS" "$target/.release-checksum"
fi
compose() {
  local release=$1; shift
  local tag; tag=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$release/package.json")
  FACILITIES_IMAGE="facilities:$tag" docker compose --project-name facilities --env-file "$ROOT/.env" -f "$release/compose.yaml" -f "$release/deployment/image.yaml" "$@"
}
compose "$target" build app
compose "$target" up -d db
stopped=0
rollback() {
  if [[ $stopped == 1 && -n "$previous" && -d "$previous" ]]; then
    echo 'Update failed; restoring the previous application image. Database backup is retained.'
    compose "$previous" up -d --no-deps app || true
  elif [[ -z "$previous" ]]; then
    compose "$target" stop app || true
  fi
}
trap 'rollback; rm -rf -- "$work"' ERR
if [[ -n "$previous" && -d "$previous" ]]; then
  compose "$previous" stop app
  stopped=1
fi
# Wait for PostgreSQL even on first install.
ready=0
for attempt in $(seq 1 60); do
  if compose "$target" exec -T db pg_isready -U facilities -d facilities >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[[ $ready == 1 ]]
backup="$ROOT/backups/$(date -u +%Y%m%dT%H%M%SZ)-before-$version.sql"
compose "$target" exec -T db pg_dump -U facilities facilities > "$backup"
test -s "$backup"
compose "$target" up -d --no-deps --no-build app
healthy=0
for attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3000/health | python3 -c 'import json,sys; r=json.load(sys.stdin); assert r["ok"] and "v"+r["version"]==sys.argv[1]' "$version" 2>/dev/null; then healthy=1; break; fi
  sleep 2
done
[[ $healthy == 1 ]]
ln -sfn "$target" "$ROOT/current.next"
mv -Tf "$ROOT/current.next" "$ROOT/current"
install -m 755 "$target/deployment/facilities-update.sh" "$ROOT/bin/facilities-update.next"
mv -f "$ROOT/bin/facilities-update.next" "$ROOT/bin/facilities-update"
trap - ERR
echo "Installed $version. Backup: $backup"
