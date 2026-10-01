#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT=${FACILITIES_HOME:-/opt/facilities}
REPO=${FACILITIES_REPOSITORY:-ssan9876/facilities}
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo 'Invalid repository'; exit 1; }
[[ $EUID == 0 ]] || { echo 'Run with sudo.'; exit 1; }
mkdir -p "$ROOT"/releases "$ROOT"/backups "$ROOT"/bin "$ROOT"/config
# The update agent: the app (container user 1000) may drop request.json into $RUN; a root
# systemd path unit runs this script with --from-request. The app never gets Docker access.
RUN="$ROOT/run"
APP_UID=1000
prepare_run_dir() {
  mkdir -p "$RUN"
  chown "$APP_UID:$APP_UID" "$RUN"
  chmod 750 "$RUN"
}
install_agent() {
  command -v systemctl >/dev/null 2>&1 || { echo 'systemd is not available; the in-app update button stays disabled.'; return 0; }
  prepare_run_dir
  cat > /etc/systemd/system/facilities-update.service <<UNIT
[Unit]
Description=Facilities update requested from the web app
[Service]
Type=oneshot
ExecStart=$ROOT/bin/facilities-update --from-request
StandardOutput=file:$RUN/update.log
StandardError=inherit
UNIT
  cat > /etc/systemd/system/facilities-update.path <<UNIT
[Unit]
Description=Watch for Facilities update requests
[Path]
PathExists=$RUN/request.json
Unit=facilities-update.service
[Install]
WantedBy=multi-user.target
UNIT
  local schedule
  schedule=$(env_value BACKUP_SCHEDULE '*-*-* 02:30:00')
  cat > /etc/systemd/system/facilities-backup.service <<UNIT
[Unit]
Description=Facilities database backup
[Service]
Type=oneshot
ExecStart=$ROOT/bin/facilities-update --backup
UNIT
  cat > /etc/systemd/system/facilities-backup.timer <<UNIT
[Unit]
Description=Nightly Facilities database backup
[Timer]
OnCalendar=$schedule
Persistent=true
RandomizedDelaySec=300
[Install]
WantedBy=timers.target
UNIT
  cat > /etc/systemd/system/facilities-backup-request.path <<UNIT
[Unit]
Description=Watch for Facilities "back up now" requests
[Path]
PathExists=$RUN/backup-request.json
Unit=facilities-backup.service
[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now facilities-update.path facilities-backup.timer facilities-backup-request.path >/dev/null
  echo "Update agent installed: the Settings → Updates button can now install releases."
  echo "Nightly backups scheduled ($schedule); Settings → Backups shows their status."
}
# Reads one KEY=value from .env without executing the file.
env_value() {
  local value
  value=$(grep -E "^$1=" "$ROOT/.env" 2>/dev/null | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
  echo "${value:-$2}"
}
if [[ "${1:-}" == --install-agent ]]; then install_agent; exit 0; fi
# Nightly (or on-demand) database backup with retention and an optional off-host copy.
if [[ "${1:-}" == --backup ]]; then
  rm -f -- "$RUN/backup-request.json" 2>/dev/null || true
  exec 9>"$ROOT/update.lock"
  flock -w 900 9 || { echo 'An update is still running; backup skipped.'; exit 1; }
  current=$(readlink -f "$ROOT/current" || true)
  [[ -d "$current" ]] || { echo 'Facilities is not installed.'; exit 1; }
  keep=$(env_value BACKUP_KEEP_DAYS 14)
  [[ "$keep" =~ ^[0-9]{1,4}$ ]] || keep=14
  copy_to=$(env_value BACKUP_COPY_TO '')
  tag=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$current/package.json")
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  file="$ROOT/backups/nightly-$stamp.sql.gz"
  report() {
    python3 - "$RUN/backup.json" "$ROOT/backups" "$1" "$2" "$keep" "$copy_to" "$3" <<'PY'
import json,os,sys,datetime
path,folder,state,message,keep,copy_to,copied=sys.argv[1:8]
files=sorted((f for f in os.listdir(folder) if f.endswith(('.sql','.sql.gz'))),reverse=True)
recent=[{'name':f,'size':os.path.getsize(os.path.join(folder,f)),'at':datetime.datetime.fromtimestamp(os.path.getmtime(os.path.join(folder,f)),datetime.timezone.utc).isoformat()} for f in files[:12]]
try: previous=json.load(open(path))
except Exception: previous={}
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
body={'state':state,'message':message,'at':now,'keep_days':int(keep),'copy_to':bool(copy_to),'copied':copied=='yes','recent':recent,
      'last_success':now if state=='succeeded' else previous.get('last_success')}
tmp=path+'.tmp'
with open(tmp,'w') as f: json.dump(body,f)
os.chmod(tmp,0o644); os.replace(tmp,path)
PY
    chown "$APP_UID:$APP_UID" "$RUN/backup.json" 2>/dev/null || true
  }
  [[ -d "$RUN" ]] && report running 'Backing up the database.' no
  trap 'rm -f -- "$file.tmp"; [[ -d "$RUN" ]] && report failed "The backup failed. See journalctl -u facilities-backup on the server." no' ERR
  FACILITIES_IMAGE="facilities:$tag" docker compose --project-name facilities --env-file "$ROOT/.env" -f "$current/compose.yaml" -f "$current/deployment/image.yaml" \
    exec -T db pg_dump -U facilities facilities | gzip -9 > "$file.tmp"
  [[ $(stat -c %s "$file.tmp") -gt 100 ]]
  mv "$file.tmp" "$file"
  chmod 600 "$file"
  # Retention applies to nightly backups only; backups taken before updates are kept.
  find "$ROOT/backups" -maxdepth 1 -name 'nightly-*.sql.gz' -mtime +"$keep" -delete
  copied=no
  if [[ -n "$copy_to" ]]; then
    rsync -a --chmod=F600 -e 'ssh -o BatchMode=yes -o ConnectTimeout=20' "$file" "$copy_to/" && copied=yes
  fi
  trap - ERR
  if [[ -n "$copy_to" && $copied == no ]]; then
    [[ -d "$RUN" ]] && report failed "Saved $(basename "$file") on the server, but copying it to $copy_to failed." no
    exit 1
  fi
  [[ -d "$RUN" ]] && report succeeded "Saved $(basename "$file")$([[ $copied == yes ]] && echo " and copied it off the server")." "$copied"
  echo "Backup saved: $file"
  exit 0
fi
# Status the web app reads while it waits for the new version.
write_status() {
  [[ -d "$RUN" ]] || return 0
  python3 - "$RUN/status.json" "$1" "${2:-}" "${3:-}" <<'PY'
import json,os,sys,datetime
path,state,version,message=sys.argv[1:5]
tmp=path+'.tmp'
with open(tmp,'w') as f: json.dump({'state':state,'version':version,'message':message,'at':datetime.datetime.now(datetime.timezone.utc).isoformat()},f)
os.chmod(tmp,0o644); os.replace(tmp,path)
PY
  chown "$APP_UID:$APP_UID" "$RUN/status.json" 2>/dev/null || true
}
from_request=0
if [[ "${1:-}" == --from-request ]]; then
  from_request=1
  request="$RUN/request.json"
  [[ -f "$request" && ! -L "$request" ]] || { echo 'No update request.'; exit 0; }
  # Only "latest" or a published vMAJOR.MINOR.PATCH may be requested; anything else is refused.
  requested=$(python3 - "$request" <<'PY'
import json,re,sys
try:
    with open(sys.argv[1]) as f: body=json.load(f)
    v=body.get('version','latest')
    assert isinstance(v,str) and (v=='latest' or re.fullmatch(r'v\d{1,4}\.\d{1,4}\.\d{1,4}',v))
    print(v)
except Exception:
    print('invalid')
PY
)
  rm -f -- "$request"
  if [[ "$requested" == invalid ]]; then write_status failed '' 'The update request was not valid.'; exit 1; fi
  set -- "$([[ "$requested" == latest ]] && echo --latest || echo "$requested")"
  write_status running "$requested" 'Downloading and verifying the release.'
  trap 'write_status failed "${version:-}" "The update failed; the previous version keeps running. See $RUN/update.log on the server."' ERR
fi
exec 9>"$ROOT/update.lock"
flock -n 9 || { [[ $from_request == 1 ]] && write_status failed '' 'Another update is already running.'; echo 'Another update is running.'; exit 1; }
curl_https() { curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --retry 3 --connect-timeout 15 "$@"; }
version=${1:---check}
automatic=0
if [[ "$version" == --latest || "$version" == --check ]]; then
  automatic=1
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
[[ -d "$previous" ]] || previous=''
if [[ ( $automatic == 1 || $from_request == 1 ) && -n "$previous" ]]; then
  python3 - "$previous/package.json" "$version" <<'PY'
import json,sys
installed=tuple(map(int,json.load(open(sys.argv[1]))['version'].split('.')))
requested=tuple(map(int,sys.argv[2][1:].split('.')))
assert requested>=installed, 'Latest release is older than this installation. Use an explicit version only after reviewing downgrade compatibility.'
PY
fi
target="$ROOT/releases/$version"
if [[ "$previous" == "$target" ]]; then
  [[ $from_request == 1 ]] && write_status succeeded "$version" "$version is already installed."
  echo "$version is already installed."
  exit 0
fi
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
root=pathlib.Path(sys.argv[2])/'facilities'
# Python's data filter clears directory modes; a 077 updater umask would
# otherwise leave public asset directories readable only by root.
root.chmod(0o755)
for path in root.rglob('*'):
    if path.is_dir(): path.chmod(0o755)
    elif path.is_file(): path.chmod(0o755 if path.stat().st_mode & 0o111 else 0o644)
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
  COMPOSE_BAKE=false FACILITIES_IMAGE="facilities:$tag" docker compose --project-name facilities --env-file "$ROOT/.env" -f "$release/compose.yaml" -f "$release/deployment/image.yaml" "$@"
}
[[ $from_request == 1 ]] && write_status running "$version" 'Building the new version. The current version keeps running.'
prepare_run_dir
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
trap 'rollback; rm -rf -- "$work"; [[ $from_request == 1 ]] && write_status failed "$version" "The update failed and the previous version was restored. The database backup is kept."' ERR
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
[[ $from_request == 1 ]] && write_status running "$version" 'Backing up the database and restarting.'
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
install_agent >/dev/null || true
[[ $from_request == 1 ]] && write_status succeeded "$version" "Installed $version. Backup: $(basename "$backup")"
echo "Installed $version. Backup: $backup"
