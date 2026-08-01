#!/usr/bin/env bash
set -Eeuo pipefail

DATA_DIR=${1:-}
TRUSTED_UID=${2:-}
SHARED_GID=${3:-}
SERVICE_UID=${4:-}
SERVICE_GID=${5:-}

[[ -n $DATA_DIR && $TRUSTED_UID =~ ^[0-9]+$ && $SHARED_GID =~ ^[0-9]+$ && $SERVICE_UID =~ ^[0-9]+$ && $SERVICE_GID =~ ^[0-9]+$ ]] || {
  echo "Usage: $0 DATA_DIR TRUSTED_UID SHARED_GID SERVICE_UID SERVICE_GID" >&2
  exit 2
}

fail() {
  echo "$1" >&2
  exit 1
}

metadata() {
  stat -c '%u:%g:%a' -- "$1"
}

[[ -d $DATA_DIR && ! -L $DATA_DIR ]] || fail "Mutable data root must be a regular directory"
[[ -d $DATA_DIR/incidents && ! -L $DATA_DIR/incidents ]] || fail "Accepted incident storage must be a regular directory"
[[ -d $DATA_DIR/candidates && ! -L $DATA_DIR/candidates ]] || fail "Candidate inbox must be a regular directory"
[[ -d $DATA_DIR/unverified && ! -L $DATA_DIR/unverified ]] || fail "Unverified report storage must be a regular directory"
[[ -d $DATA_DIR/analytics && ! -L $DATA_DIR/analytics ]] || fail "Analytics storage must be a regular directory"
[[ -d $DATA_DIR/approvals && ! -L $DATA_DIR/approvals ]] || fail "Runtime approval storage must be a regular directory"
[[ -d $DATA_DIR/published-candidates && ! -L $DATA_DIR/published-candidates ]] || fail "Published-candidate archive must be a regular directory"

unexpected=$(find "$DATA_DIR" -xdev -mindepth 1 ! -type d ! -type f -print -quit)
[[ -z $unexpected ]] || fail "Mutable data must contain only directories and regular files"

multiply_linked=$(find "$DATA_DIR" -xdev -type f -links +1 -print -quit)
[[ -z $multiply_linked ]] || fail "Mutable data contains a multiply linked file"

[[ $(metadata "$DATA_DIR") == "$TRUSTED_UID:$SHARED_GID:750" ]] || fail "Mutable data root metadata is unsafe"
[[ $(metadata "$DATA_DIR/incidents") == "$TRUSTED_UID:$SHARED_GID:750" ]] || fail "Accepted directory metadata is unsafe"
[[ $(metadata "$DATA_DIR/candidates") == "$SERVICE_UID:$SERVICE_GID:750" ]] || fail "Candidate directory metadata is unsafe"
[[ $(metadata "$DATA_DIR/unverified") == "$TRUSTED_UID:$SHARED_GID:750" ]] || fail "Unverified directory metadata is unsafe"
[[ $(metadata "$DATA_DIR/analytics") == "$SERVICE_UID:$SERVICE_GID:750" ]] || fail "Analytics directory metadata is unsafe"
[[ $(metadata "$DATA_DIR/approvals") == "$TRUSTED_UID:$SHARED_GID:750" ]] || fail "Runtime approval directory metadata is unsafe"
[[ $(metadata "$DATA_DIR/published-candidates") == "$TRUSTED_UID:$SHARED_GID:750" ]] || fail "Published-candidate archive metadata is unsafe"

while IFS= read -r -d '' path; do
  [[ $(metadata "$path") == "$TRUSTED_UID:$SHARED_GID:750" ]] || fail "Accepted directory metadata is unsafe: $path"
done < <(find "$DATA_DIR/incidents" -xdev -type d -print0)

while IFS= read -r -d '' path; do
  [[ $(metadata "$path") == "$TRUSTED_UID:$SHARED_GID:640" ]] || fail "Accepted file metadata is unsafe: $path"
done < <(find "$DATA_DIR/incidents" -xdev -type f -print0)

while IFS= read -r -d '' path; do
  [[ $(metadata "$path") == "$TRUSTED_UID:$SHARED_GID:750" ]] || fail "Unverified directory metadata is unsafe: $path"
done < <(find "$DATA_DIR/unverified" -xdev -type d -print0)

while IFS= read -r -d '' path; do
  [[ $(metadata "$path") == "$TRUSTED_UID:$SHARED_GID:640" ]] || fail "Unverified file metadata is unsafe: $path"
done < <(find "$DATA_DIR/unverified" -xdev -type f -print0)

while IFS= read -r -d '' path; do
  [[ $(metadata "$path") == "$SERVICE_UID:$SERVICE_GID:750" ]] || fail "Candidate directory metadata is unsafe: $path"
done < <(find "$DATA_DIR/candidates" -xdev -type d -print0)

while IFS= read -r -d '' path; do
  current=$(metadata "$path")
  [[ $current == "$SERVICE_UID:$SERVICE_GID:600" || $current == "$SERVICE_UID:$SERVICE_GID:640" ]] || fail "Candidate file metadata is unsafe: $path"
done < <(find "$DATA_DIR/candidates" -xdev -type f -print0)

while IFS= read -r -d '' path; do
  [[ $(metadata "$path") == "$SERVICE_UID:$SERVICE_GID:750" ]] || fail "Analytics directory metadata is unsafe: $path"
done < <(find "$DATA_DIR/analytics" -xdev -type d -print0)

while IFS= read -r -d '' path; do
  [[ $(metadata "$path") == "$SERVICE_UID:$SERVICE_GID:600" ]] || fail "Analytics file metadata is unsafe: $path"
done < <(find "$DATA_DIR/analytics" -xdev -type f -print0)

for protected_directory in approvals published-candidates; do
  while IFS= read -r -d '' path; do
    [[ $(metadata "$path") == "$TRUSTED_UID:$SHARED_GID:750" ]] || fail "Protected publisher directory metadata is unsafe: $path"
  done < <(find "$DATA_DIR/$protected_directory" -xdev -type d -print0)
  while IFS= read -r -d '' path; do
    [[ $(metadata "$path") == "$TRUSTED_UID:$SHARED_GID:640" ]] || fail "Protected publisher file metadata is unsafe: $path"
  done < <(find "$DATA_DIR/$protected_directory" -xdev -type f -print0)
done

while IFS= read -r -d '' path; do
  [[ -f $path ]] || fail "Unexpected directory beneath mutable data root: $path"
  current=$(metadata "$path")
  [[ $current == "$TRUSTED_UID:"*:600 || $current == "$TRUSTED_UID:"*:640 ]] || fail "Root-level mutable data file metadata is unsafe: $path"
done < <(find "$DATA_DIR" -xdev -mindepth 1 -maxdepth 1 ! -name incidents ! -name candidates ! -name unverified ! -name analytics ! -name approvals ! -name published-candidates -print0)

printf 'DATA_PERMISSIONS=secure\n'
