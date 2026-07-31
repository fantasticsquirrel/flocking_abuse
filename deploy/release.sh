#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SOURCE_ROOT=${1:-}
RELEASE_SHA=${2:-}
[[ ${EUID} -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ -d ${SOURCE_ROOT}/.git ]] || { echo "Usage: $0 SOURCE_GIT_CHECKOUT 40_HEX_SHA" >&2; exit 2; }
[[ ${RELEASE_SHA} =~ ^[0-9a-f]{40}$ ]] || { echo "Release SHA must be 40 lowercase hex characters" >&2; exit 2; }
[[ $(git -C "$SOURCE_ROOT" rev-parse HEAD) == "$RELEASE_SHA" ]] || { echo "Source HEAD does not match requested release" >&2; exit 3; }
[[ -z $(git -C "$SOURCE_ROOT" status --porcelain) ]] || { echo "Source checkout is dirty" >&2; exit 3; }
git -C "$SOURCE_ROOT" cat-file -e "${RELEASE_SHA}^{commit}"

exec 9>/run/lock/flocking-abuse-deploy.lock
flock -n 9 || { echo "Another Flocking Abuse deployment is already running" >&2; exit 5; }

RELEASE_ROOT=/opt/flocking-abuse/releases
RELEASE_DIR=${RELEASE_ROOT}/${RELEASE_SHA}
CURRENT=/opt/flocking-abuse/current
STAGING=${RELEASE_ROOT}/.${RELEASE_SHA}.staging-$$
DATA_DIR=/var/lib/flocking-abuse/data
BACKUP=
PREVIOUS=$(readlink -f "$CURRENT" 2>/dev/null || true)
PREVIOUS_SHA=$(basename "$PREVIOUS" 2>/dev/null || true)
UNIT=/etc/systemd/system/flocking-abuse.service
NGINX_SITE=/etc/nginx/sites-available/flockingabuse.multihost.ing
NGINX_ENABLED=/etc/nginx/sites-enabled/flockingabuse.multihost.ing
RELEASE_ENV=/etc/flocking-abuse/release.env
TARGET_NGINX_TEST=
SERVICE_TOUCHED=0
SERVICE_UID=$(id -u flocking-abuse)
SERVICE_GID=$(id -g flocking-abuse)

require_regular_artifact() {
  local root=$1 relative_path=$2 expected="$1/$2" resolved
  [[ -f $expected && ! -L $expected ]] || return 1
  resolved=$(realpath -e "$expected") || return 1
  [[ $resolved == "$root/$relative_path" ]]
}

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

restore_operational_files() {
  local target backup_file failed=0
  for target in "$UNIT" "$NGINX_SITE" "$RELEASE_ENV"; do
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
  return "$failed"
}

restore_service_state() {
  local prior_mode failed=0
  prior_mode=$(<"$BACKUP/prior.mode") || failed=1
  systemctl daemon-reload || failed=1
  if [[ $prior_mode == deployed ]]; then
    systemctl enable flocking-abuse.service >/dev/null || failed=1
    systemctl restart flocking-abuse.service || failed=1
    verify_health "$PREVIOUS_SHA" || failed=1
  else
    rm -f /etc/systemd/system/multi-user.target.wants/flocking-abuse.service || failed=1
    if (( SERVICE_TOUCHED != 0 )); then
      systemctl stop flocking-abuse.service || failed=1
    elif [[ $(systemctl is-active flocking-abuse.service 2>/dev/null || true) != inactive ]]; then
      failed=1
    fi
  fi
  return "$failed"
}

rollback_on_error() {
  local status=$1 recovery_failed=0
  trap - ERR INT TERM
  set +e
  echo "Deployment failed; restoring operational configuration and previous release" >&2
  restore_operational_files || recovery_failed=1
  if [[ -n $PREVIOUS && -d $PREVIOUS ]]; then
    local fallback=/opt/flocking-abuse/.rollback-$$
    ln -s "$PREVIOUS" "$fallback" || recovery_failed=1
    mv -Tf "$fallback" "$CURRENT" || recovery_failed=1
  else
    rm -f "$CURRENT" || recovery_failed=1
  fi
  restore_service_state || recovery_failed=1
  if ! nginx -t || ! systemctl reload nginx; then recovery_failed=1; fi
  rm -rf "$STAGING" "$RELEASE_DIR" || recovery_failed=1
  if [[ -n ${TARGET_NGINX_TEST:-} ]]; then rm -f "$TARGET_NGINX_TEST" || recovery_failed=1; fi
  if (( recovery_failed != 0 )); then
    echo "CRITICAL: deployment failed and rollback did not fully recover; manual intervention required" >&2
    exit 90
  fi
  exit "$status"
}

[[ ! -L /opt/flocking-abuse && ! -L $RELEASE_ROOT ]] || { echo "Release root must not be a symlink" >&2; exit 6; }
install -d -m 0755 -o root -g root /opt/flocking-abuse "$RELEASE_ROOT"
for required_data_dir in "$DATA_DIR" "$DATA_DIR/incidents" "$DATA_DIR/candidates"; do
  [[ -d $required_data_dir && ! -L $required_data_dir ]] || { echo "Pre-provisioned mutable data directories are required" >&2; exit 6; }
done
require_regular_artifact "$SOURCE_ROOT" deploy/verify-data-permissions.sh || { echo "Source permission verifier is unconfined" >&2; exit 6; }
bash "$SOURCE_ROOT/deploy/verify-data-permissions.sh" "$DATA_DIR" 0 "$SERVICE_GID" "$SERVICE_UID" "$SERVICE_GID"

if [[ -e $UNIT || -L $UNIT ]]; then
  [[ -f $UNIT && ! -L $UNIT ]] || { echo "Existing unit must be a regular persistent system unit" >&2; exit 6; }
  [[ -L $CURRENT && $PREVIOUS_SHA =~ ^[0-9a-f]{40}$ && $PREVIOUS == "$RELEASE_ROOT/$PREVIOUS_SHA" && -d $PREVIOUS && ! -L $PREVIOUS ]] || { echo "Existing service lacks a confined immutable current release" >&2; exit 6; }
  [[ $(systemctl is-enabled flocking-abuse.service 2>/dev/null || true) == enabled ]] || { echo "Existing service must be persistently enabled before deployment" >&2; exit 6; }
  [[ $(systemctl is-active flocking-abuse.service 2>/dev/null || true) == active ]] || { echo "Existing service must be active before deployment" >&2; exit 6; }
  verify_health "$PREVIOUS_SHA" || { echo "Existing service must be healthy before deployment" >&2; exit 6; }
  PRIOR_MODE=deployed
else
  [[ -z $PREVIOUS ]] || { echo "Current release link exists without an installed service" >&2; exit 6; }
  [[ $(systemctl show flocking-abuse.service -p LoadState --value 2>/dev/null || true) == not-found ]] || { echo "First install requires no systemd unit from any search path" >&2; exit 6; }
  [[ $(systemctl is-enabled flocking-abuse.service 2>/dev/null || true) == not-found ]] || { echo "First install requires no persistent or runtime enablement" >&2; exit 6; }
  [[ $(systemctl is-active flocking-abuse.service 2>/dev/null || true) == inactive ]] || { echo "First install requires an inactive service" >&2; exit 6; }
  PRIOR_MODE=absent
fi

install -d -m 0700 -o root -g root /var/backups/flocking-abuse
BACKUP=$(mktemp -d "/var/backups/flocking-abuse/release-$(date -u +%Y%m%dT%H%M%SZ)-${RELEASE_SHA:0:12}-XXXXXX")
chmod 0700 "$BACKUP"
printf '%s\n' "$PRIOR_MODE" > "$BACKUP/prior.mode"
for path in "$UNIT" "$NGINX_SITE" "$RELEASE_ENV"; do
  if [[ -e $path || -L $path ]]; then cp -a "$path" "$BACKUP/"; fi
done
if [[ -L $NGINX_ENABLED ]]; then
  readlink "$NGINX_ENABLED" > "$BACKUP/nginx-enabled.target"
elif [[ -e $NGINX_ENABLED ]]; then
  cp -a "$NGINX_ENABLED" "$BACKUP/nginx-enabled.entry"
fi

[[ ! -e $RELEASE_DIR && ! -L $RELEASE_DIR ]] || { echo "Release directory already exists; refusing an unverified artifact: $RELEASE_DIR" >&2; exit 4; }
trap 'rollback_on_error $?' ERR
trap 'rollback_on_error 130' INT
trap 'rollback_on_error 143' TERM
install -d -m 0755 -o root -g root "$STAGING"
git -C "$SOURCE_ROOT" archive "$RELEASE_SHA" | tar -x -C "$STAGING"
if [[ -n $(find "$STAGING" -type l -print -quit) ]]; then
  echo "Tracked release export contains a symlink" >&2
  false
fi
for artifact in package.json package-lock.json deploy/flocking-abuse.service deploy/flockingabuse.multihost.ing.nginx deploy/verify-data-permissions.sh; do
  require_regular_artifact "$STAGING" "$artifact" || { echo "Release export contains an unconfined artifact: $artifact" >&2; false; }
done
cd "$STAGING"
npm ci
if [[ $PRIOR_MODE == deployed ]]; then
  SERVICE_TOUCHED=1
  systemctl stop flocking-abuse.service
fi
bash "$STAGING/deploy/verify-data-permissions.sh" "$DATA_DIR" 0 "$SERVICE_GID" "$SERVICE_UID" "$SERVICE_GID"
DATA_DIR="$DATA_DIR" npm run validate:data
DATA_DIR="$DATA_DIR" NODE_ENV=production INCLUDE_DRAFTS=0 npm run build
npm prune --omit=dev
for artifact in deploy/flocking-abuse.service deploy/flockingabuse.multihost.ing.nginx dist-server/server/index.js dist/index.html; do
  require_regular_artifact "$STAGING" "$artifact" || { echo "Built release contains an unconfined artifact: $artifact" >&2; false; }
done
systemd-analyze verify "$STAGING/deploy/flocking-abuse.service"
TARGET_NGINX_TEST=$(mktemp /etc/nginx/.flocking-release-target.XXXXXX.conf)
printf 'events {}\nhttp { include /etc/nginx/mime.types; include %s; }\n' "$STAGING/deploy/flockingabuse.multihost.ing.nginx" > "$TARGET_NGINX_TEST"
if ! nginx -t -c "$TARGET_NGINX_TEST"; then
  rm -f "$TARGET_NGINX_TEST"
  echo "Target nginx configuration failed preflight" >&2
  false
fi
rm -f "$TARGET_NGINX_TEST"
chown -R root:root "$STAGING"
chmod -R go-w "$STAGING"
mv "$STAGING" "$RELEASE_DIR"

install -m 0644 -o root -g root "$RELEASE_DIR/deploy/flocking-abuse.service" "$UNIT"
printf 'RELEASE_SHA=%s\n' "$RELEASE_SHA" > "$BACKUP/release.env.new"
install -m 0644 -o root -g root "$BACKUP/release.env.new" "$RELEASE_ENV"
systemd-analyze verify "$UNIT"

NEXT=/opt/flocking-abuse/.current-${RELEASE_SHA}-$$
ln -s "$RELEASE_DIR" "$NEXT"
mv -Tf "$NEXT" "$CURRENT"
systemctl daemon-reload
systemctl enable flocking-abuse.service >/dev/null
SERVICE_TOUCHED=1
systemctl restart flocking-abuse.service
verify_health "$RELEASE_SHA"

install -m 0644 -o root -g root "$RELEASE_DIR/deploy/flockingabuse.multihost.ing.nginx" "$NGINX_SITE"
ln -sfn "$NGINX_SITE" "$NGINX_ENABLED"
nginx -t
systemctl reload nginx
trap - ERR INT TERM
printf 'DEPLOYED_RELEASE=%s\nBACKUP=%s\n' "$RELEASE_SHA" "$BACKUP"
