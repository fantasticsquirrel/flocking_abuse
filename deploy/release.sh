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
RELEASE_ROOT=/opt/flocking-abuse/releases
RELEASE_DIR=${RELEASE_ROOT}/${RELEASE_SHA}
CURRENT=/opt/flocking-abuse/current
STAGING=${RELEASE_ROOT}/.${RELEASE_SHA}.staging-$$
DATA_DIR=/var/lib/flocking-abuse/data
BACKUP=/var/backups/flocking-abuse/release-$(date -u +%Y%m%dT%H%M%SZ)-${RELEASE_SHA:0:12}
PREVIOUS=$(readlink -f "$CURRENT" 2>/dev/null || true)

install -d -m 0755 -o root -g root /opt/flocking-abuse "$RELEASE_ROOT"
install -d -m 0750 -o flocking-abuse -g flocking-abuse "$DATA_DIR" "$DATA_DIR/incidents" "$DATA_DIR/candidates"
install -d -m 0700 -o root -g root "$BACKUP"
cp -a "$DATA_DIR" "$BACKUP/data"
for path in /etc/systemd/system/flocking-abuse.service /etc/nginx/sites-available/flockingabuse.multihost.ing /etc/flocking-abuse/release.env; do
  [[ ! -e $path ]] || cp -a "$path" "$BACKUP/"
done

if [[ ! -d $RELEASE_DIR ]]; then
  install -d -m 0755 -o root -g root "$STAGING"
  git -C "$SOURCE_ROOT" archive "$RELEASE_SHA" | tar -x -C "$STAGING"
  cd "$STAGING"
  npm ci
  DATA_DIR="$DATA_DIR" npm run validate:data
  npm run build
  npm prune --omit=dev
  chown -R root:root "$STAGING"
  chmod -R go-w "$STAGING"
  mv "$STAGING" "$RELEASE_DIR"
fi

install -m 0644 -o root -g root "$RELEASE_DIR/deploy/flocking-abuse.service" /etc/systemd/system/flocking-abuse.service
printf 'RELEASE_SHA=%s\n' "$RELEASE_SHA" > "$BACKUP/release.env.new"
install -m 0644 -o root -g root "$BACKUP/release.env.new" /etc/flocking-abuse/release.env
systemd-analyze verify /etc/systemd/system/flocking-abuse.service

NEXT=/opt/flocking-abuse/.current-${RELEASE_SHA}-$$
ln -s "$RELEASE_DIR" "$NEXT"
mv -Tf "$NEXT" "$CURRENT"
systemctl daemon-reload
systemctl enable flocking-abuse.service >/dev/null
systemctl restart flocking-abuse.service

healthy=false
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 2 http://127.0.0.1:8110/health \
    | RELEASE_SHA="$RELEASE_SHA" node -e 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>{const j=JSON.parse(b);process.exit(j.status==="ready"&&j.release===process.env.RELEASE_SHA?0:1)})'; then
    healthy=true
    break
  fi
  sleep 1
done

if [[ $healthy != true ]]; then
  echo "New release failed readiness; rolling back service" >&2
  if [[ -n $PREVIOUS && -d $PREVIOUS ]]; then
    FALLBACK=/opt/flocking-abuse/.rollback-$$
    ln -s "$PREVIOUS" "$FALLBACK"
    mv -Tf "$FALLBACK" "$CURRENT"
    printf 'RELEASE_SHA=%s\n' "$(basename "$PREVIOUS")" > "$BACKUP/release.env.rollback"
    install -m 0644 -o root -g root "$BACKUP/release.env.rollback" /etc/flocking-abuse/release.env
    systemctl restart flocking-abuse.service
  else
    rm -f "$CURRENT"
    systemctl stop flocking-abuse.service
  fi
  exit 4
fi

install -m 0644 -o root -g root "$RELEASE_DIR/deploy/flockingabuse.multihost.ing.nginx" /etc/nginx/sites-available/flockingabuse.multihost.ing
ln -sfn /etc/nginx/sites-available/flockingabuse.multihost.ing /etc/nginx/sites-enabled/flockingabuse.multihost.ing
nginx -t
systemctl reload nginx
printf 'DEPLOYED_RELEASE=%s\nBACKUP=%s\n' "$RELEASE_SHA" "$BACKUP"
