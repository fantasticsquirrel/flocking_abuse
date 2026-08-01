#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

TARGET_SHA=${1:-}
[[ ${EUID} -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ ${TARGET_SHA} =~ ^[0-9a-f]{40}$ ]] || { echo "Usage: $0 40_HEX_RELEASE_SHA" >&2; exit 2; }

exec 9>/run/lock/flocking-abuse-deploy.lock
flock -n 9 || { echo "Another Flocking Abuse deploy or rollback is active" >&2; exit 5; }

RELEASE_ROOT=/opt/flocking-abuse/releases
TARGET=${RELEASE_ROOT}/${TARGET_SHA}
CURRENT=/opt/flocking-abuse/current
PREVIOUS=$(readlink -f "$CURRENT" 2>/dev/null || true)
PREVIOUS_SHA=$(basename "$PREVIOUS" 2>/dev/null || true)
UNIT=/etc/systemd/system/flocking-abuse.service
PUBLISHER_UNIT=/etc/systemd/system/flocking-abuse-publisher.service
NGINX_SITE=/etc/nginx/sites-available/flockingabuse.multihost.ing
NGINX_ENABLED=/etc/nginx/sites-enabled/flockingabuse.multihost.ing
RELEASE_ENV=/etc/flocking-abuse/release.env
BACKUP=

require_regular_artifact() {
  local root=$1 relative_path=$2 expected="$1/$2" resolved
  [[ -f $expected && ! -L $expected ]] || return 1
  resolved=$(realpath -e "$expected") || return 1
  [[ $resolved == "$root/$relative_path" ]]
}

[[ ! -L /opt/flocking-abuse && ! -L $RELEASE_ROOT ]] || { echo "Release root must not be a symlink" >&2; exit 3; }
[[ -d $TARGET && ! -L $TARGET && $(realpath "$TARGET") == "$TARGET" ]] || { echo "Target release is not a confined regular directory: $TARGET" >&2; exit 3; }
for artifact in deploy/flocking-abuse.service deploy/flockingabuse.multihost.ing.nginx dist-server/server/index.js dist/index.html; do
  require_regular_artifact "$TARGET" "$artifact" || { echo "Target release is missing an unconfined regular $artifact" >&2; exit 3; }
done
TARGET_HAS_PUBLISHER=0
if require_regular_artifact "$TARGET" deploy/flocking-abuse-publisher.service \
  && require_regular_artifact "$TARGET" dist-server/server/publisher.js; then
  TARGET_HAS_PUBLISHER=1
fi
[[ -L $CURRENT && $PREVIOUS_SHA =~ ^[0-9a-f]{40}$ && $PREVIOUS == "$RELEASE_ROOT/$PREVIOUS_SHA" && -d $PREVIOUS && ! -L $PREVIOUS ]] || { echo "Current release is not a confined immutable deployment" >&2; exit 3; }
[[ -f $UNIT && ! -L $UNIT ]] || { echo "Current unit is not a regular persistent system unit" >&2; exit 3; }
[[ $PREVIOUS_SHA != "$TARGET_SHA" ]] || { echo "Target release is already active" >&2; exit 3; }
[[ $(systemctl is-enabled flocking-abuse.service 2>/dev/null || true) == enabled ]] || { echo "Current service is not persistently enabled" >&2; exit 3; }
[[ $(systemctl is-active flocking-abuse.service 2>/dev/null || true) == active ]] || { echo "Current service is not active" >&2; exit 3; }

verify_health() {
  local expected_sha=$1
  for _ in $(seq 1 30); do
    if curl --fail --silent --show-error --max-time 2 http://127.0.0.1:8110/health \
      | RELEASE_SHA="$expected_sha" node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const j=JSON.parse(b);process.exit(j.status==="ready"&&j.release===process.env.RELEASE_SHA?0:1)})'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

restore_previous() {
  local failed=0 target backup_file
  for target in "$UNIT" "$PUBLISHER_UNIT" "$NGINX_SITE" "$RELEASE_ENV"; do
    backup_file="$BACKUP/$(basename "$target")"
    rm -f "$target" || failed=1
    if [[ -e $backup_file || -L $backup_file ]]; then cp -a "$backup_file" "$target" || failed=1; fi
  done
  rm -f "$NGINX_ENABLED" || failed=1
  if [[ -f $BACKUP/nginx-enabled.target ]]; then
    ln -s "$(<"$BACKUP/nginx-enabled.target")" "$NGINX_ENABLED" || failed=1
  elif [[ -e $BACKUP/nginx-enabled.entry || -L $BACKUP/nginx-enabled.entry ]]; then
    cp -a "$BACKUP/nginx-enabled.entry" "$NGINX_ENABLED" || failed=1
  fi
  local fallback=/opt/flocking-abuse/.rollback-recovery-$$
  ln -s "$PREVIOUS" "$fallback" || failed=1
  mv -Tf "$fallback" "$CURRENT" || failed=1
  systemctl daemon-reload || failed=1
  if [[ -f $PUBLISHER_UNIT ]]; then
    systemctl enable flocking-abuse-publisher.service >/dev/null || failed=1
    systemctl restart flocking-abuse-publisher.service || failed=1
  else
    systemctl disable --now flocking-abuse-publisher.service >/dev/null 2>&1 || true
  fi
  systemctl enable flocking-abuse.service >/dev/null || failed=1
  systemctl restart flocking-abuse.service || failed=1
  verify_health "$PREVIOUS_SHA" || failed=1
  if ! nginx -t || ! systemctl reload nginx; then failed=1; fi
  return "$failed"
}

rollback_failed() {
  local status=$1
  trap - ERR INT TERM
  set +e
  echo "Rollback activation failed; restoring $PREVIOUS_SHA" >&2
  if ! restore_previous; then
    echo "CRITICAL: rollback target failed and previous release did not fully recover" >&2
    exit 90
  fi
  exit "$status"
}

verify_health "$PREVIOUS_SHA" || { echo "Current service is not healthy" >&2; exit 3; }
if (( TARGET_HAS_PUBLISHER != 0 )); then
  systemd-analyze verify "$TARGET/deploy/flocking-abuse-publisher.service" "$TARGET/deploy/flocking-abuse.service"
else
  systemd-analyze verify "$TARGET/deploy/flocking-abuse.service"
fi
TARGET_NGINX_TEST=$(mktemp /etc/nginx/.flocking-rollback-target.XXXXXX.conf)
printf 'events {}\nhttp { include /etc/nginx/mime.types; include %s; }\n' "$TARGET/deploy/flockingabuse.multihost.ing.nginx" > "$TARGET_NGINX_TEST"
if ! nginx -t -c "$TARGET_NGINX_TEST"; then
  rm -f "$TARGET_NGINX_TEST"
  echo "Target nginx configuration failed preflight" >&2
  exit 3
fi
rm -f "$TARGET_NGINX_TEST"
nginx -t
install -d -m 0700 -o root -g root /var/backups/flocking-abuse
BACKUP=$(mktemp -d "/var/backups/flocking-abuse/rollback-$(date -u +%Y%m%dT%H%M%SZ)-${PREVIOUS_SHA:0:12}-to-${TARGET_SHA:0:12}-XXXXXX")
chmod 0700 "$BACKUP"
for path in "$UNIT" "$PUBLISHER_UNIT" "$NGINX_SITE" "$RELEASE_ENV"; do
  if [[ -e $path || -L $path ]]; then cp -a "$path" "$BACKUP/"; fi
done
if [[ -L $NGINX_ENABLED ]]; then
  readlink "$NGINX_ENABLED" > "$BACKUP/nginx-enabled.target"
elif [[ -e $NGINX_ENABLED ]]; then
  cp -a "$NGINX_ENABLED" "$BACKUP/nginx-enabled.entry"
fi
trap 'rollback_failed $?' ERR
trap 'rollback_failed 130' INT
trap 'rollback_failed 143' TERM

install -m 0644 -o root -g root "$TARGET/deploy/flocking-abuse.service" "$UNIT"
if (( TARGET_HAS_PUBLISHER != 0 )); then
  install -m 0644 -o root -g root "$TARGET/deploy/flocking-abuse-publisher.service" "$PUBLISHER_UNIT"
else
  systemctl disable --now flocking-abuse-publisher.service >/dev/null 2>&1 || true
  rm -f "$PUBLISHER_UNIT"
fi
printf 'RELEASE_SHA=%s\n' "$TARGET_SHA" > "$BACKUP/release.env.new"
install -m 0644 -o root -g root "$BACKUP/release.env.new" "$RELEASE_ENV"
NEXT=/opt/flocking-abuse/.rollback-target-${TARGET_SHA}-$$
ln -s "$TARGET" "$NEXT"
mv -Tf "$NEXT" "$CURRENT"
systemctl daemon-reload
if (( TARGET_HAS_PUBLISHER != 0 )); then
  systemctl enable flocking-abuse-publisher.service >/dev/null
  systemctl restart flocking-abuse-publisher.service
fi
systemctl enable flocking-abuse.service >/dev/null
systemctl restart flocking-abuse.service
verify_health "$TARGET_SHA"
install -m 0644 -o root -g root "$TARGET/deploy/flockingabuse.multihost.ing.nginx" "$NGINX_SITE"
ln -sfn "$NGINX_SITE" "$NGINX_ENABLED"
nginx -t
systemctl reload nginx
trap - ERR INT TERM
printf 'ROLLED_BACK_TO=%s\nRECOVERY_BACKUP=%s\n' "$TARGET_SHA" "$BACKUP"
