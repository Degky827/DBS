#!/usr/bin/env bash
#
# Restores a backup set produced by scripts/backup.sh.
#
# Two modes:
#
#   Drill (default, non-destructive):
#     ./scripts/restore.sh --backup backups/sets/<stamp> --suffix _drill
#     Restores each database into <name><suffix>, runs the ledger integrity
#     check against the copy, then drops the copies unless --keep is given.
#
#   In place (destructive):
#     ./scripts/restore.sh --backup backups/sets/<stamp> --in-place
#     Stops application services, takes a fresh safety backup, restores the
#     live databases and volumes, restarts services, and verifies the ledger.
#
# Environment:
#   COMPOSE_FILE    Compose file to use (default: docker-compose.yml)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

COMPOSE_FILE="${COMPOSE_FILE:-${REPO_ROOT}/docker-compose.yml}"
DATABASES=(auth_db user_db kyc_db)
SET_DIR=""
SUFFIX=""
IN_PLACE="false"
ASSUME_YES="false"
KEEP_RESTORED="false"
VERIFY_LEDGER="true"
RUN_MIGRATIONS="false"

log() { printf '[restore] %s\n' "$*" >&2; }
die() {
  printf '[restore] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat >&2 <<'EOF'
Usage:
  scripts/restore.sh --backup <set-dir> --suffix <_suffix> [--keep] [--skip-ledger-verify]
  scripts/restore.sh --backup <set-dir> --in-place [--yes] [--migrate]

Options:
  --backup <dir>        Backup set created by scripts/backup.sh (required)
  --suffix <suffix>     Restore databases as <name><suffix> (must start with _)
  --in-place            Restore live databases and volumes (destructive)
  --yes                 Skip the typed confirmation for --in-place
  --keep                Keep suffixed databases after a successful drill
  --migrate             Run pending Prisma migrations after an in-place restore
  --skip-ledger-verify  Do not run the double-entry ledger check
  --help                Show this help
EOF
}

compose() {
  docker compose -f "${COMPOSE_FILE}" "$@"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --backup)
      [ "$#" -ge 2 ] || die "--backup requires a directory"
      SET_DIR="$2"
      shift 2
      ;;
    --suffix)
      [ "$#" -ge 2 ] || die "--suffix requires a value"
      SUFFIX="$2"
      shift 2
      ;;
    --in-place)
      IN_PLACE="true"
      shift
      ;;
    --yes)
      ASSUME_YES="true"
      shift
      ;;
    --keep)
      KEEP_RESTORED="true"
      shift
      ;;
    --migrate)
      RUN_MIGRATIONS="true"
      shift
      ;;
    --skip-ledger-verify)
      VERIFY_LEDGER="false"
      shift
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

[ -n "${SET_DIR}" ] || {
  usage
  die "--backup is required"
}

if [ "${IN_PLACE}" = "true" ]; then
  [ -z "${SUFFIX}" ] || die "Choose either --suffix or --in-place, not both"
else
  [ -n "${SUFFIX}" ] || {
    usage
    die "Pass --suffix for a non-destructive drill, or --in-place for a live restore"
  }
  [[ "${SUFFIX}" =~ ^_[a-z0-9_]+$ ]] ||
    die "--suffix must start with _ and contain only lowercase letters, digits, or _"
fi

[ -f "${COMPOSE_FILE}" ] || die "Compose file not found: ${COMPOSE_FILE}"
[ -d "${SET_DIR}" ] || die "Backup set not found: ${SET_DIR}"
[ -f "${SET_DIR}/manifest.json" ] || die "manifest.json missing from ${SET_DIR}"
[ -f "${SET_DIR}/SHA256SUMS" ] || die "SHA256SUMS missing from ${SET_DIR}"
command -v docker >/dev/null 2>&1 || die "docker is required"

log "Verifying backup checksums"
(cd "${SET_DIR}" && sha256sum -c --quiet SHA256SUMS) ||
  die "Checksum verification failed for ${SET_DIR}"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

compose ps --status running --services | grep -qx "postgres" ||
  die "postgres container is not running"

urlencode() {
  local string="$1" encoded="" char hex index
  for ((index = 0; index < ${#string}; index++)); do
    char="${string:index:1}"
    case "${char}" in
      [a-zA-Z0-9.~_-]) encoded+="${char}" ;;
      *)
        printf -v hex '%%%02X' "'${char}"
        encoded+="${hex}"
        ;;
    esac
  done
  printf '%s' "${encoded}"
}

postgres_env() {
  compose exec -T postgres sh -c "printf %s \"\${$1}\"" | tr -d '\r\n'
}

# Database names are built from the fixed list plus a validated suffix, so
# embedding them as quoted identifiers is safe here.
create_database() {
  local target="$1"
  compose exec -T postgres sh -c \
    'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
      -c "DROP DATABASE IF EXISTS \"$1\" WITH (FORCE);" \
      -c "CREATE DATABASE \"$1\";"' sh "${target}"
}

drop_database() {
  local target="$1"
  compose exec -T postgres sh -c \
    'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
      -c "DROP DATABASE IF EXISTS \"$1\" WITH (FORCE);"' sh "${target}"
}

decrypt_artifact() {
  local source="$1"
  local target="$2"

  case "${source}" in
    *.gpg)
      command -v gpg >/dev/null 2>&1 ||
        die "gpg is required to restore an encrypted backup"
      gpg --batch --yes --quiet --decrypt "${source}" >"${target}" ||
        die "Could not decrypt ${source}"
      ;;
    *)
      cp "${source}" "${target}"
      ;;
  esac
}

database_artifact() {
  local db="$1"
  if [ -f "${SET_DIR}/postgres/${db}.dump.gpg" ]; then
    echo "${SET_DIR}/postgres/${db}.dump.gpg"
  elif [ -f "${SET_DIR}/postgres/${db}.dump" ]; then
    echo "${SET_DIR}/postgres/${db}.dump"
  else
    die "No dump for ${db} in ${SET_DIR}"
  fi
}

restore_database() {
  local db="$1"
  local target="$2"
  local artifact dump tables

  artifact="$(database_artifact "${db}")"
  dump="${TMP_DIR}/${db}.dump"
  decrypt_artifact "${artifact}" "${dump}"

  compose exec -T postgres pg_restore --list <"${dump}" >/dev/null ||
    die "The ${db} dump is not a readable custom-format archive"

  log "Restoring ${db} into ${target}"
  create_database "${target}"
  compose exec -T postgres sh -c \
    'pg_restore -U "$POSTGRES_USER" -d "$1" --no-owner --no-privileges --exit-on-error' \
    sh "${target}" <"${dump}"

  tables="$(compose exec -T postgres sh -c \
    'psql -U "$POSTGRES_USER" -d "$1" -tAc \
      "SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema()"' \
    sh "${target}" | tr -d ' \r\n')"
  [ "${tables}" -gt 0 ] 2>/dev/null ||
    die "${target} has no tables after restore"

  rm -f "${dump}"
  log "${target}: ${tables} tables restored"
}

ledger_verify() {
  local target="$1"
  local user password connection

  user="$(urlencode "$(postgres_env POSTGRES_USER)")"
  password="$(urlencode "$(postgres_env POSTGRES_PASSWORD)")"
  connection="postgresql://${user}:${password}@postgres:5432/${target}?schema=public"

  log "Running ledger integrity checks against ${target}"
  compose run --rm --no-deps -T -e DATABASE_URL="${connection}" \
    user-service node prisma/verifyLedger.js
}

restore_volume() {
  local service="$1"
  local path="$2"
  local artifact="$3"

  [ -n "${artifact}" ] || die "The selected backup set has no archive for ${path}"
  [ -f "${artifact}" ] || die "Archive not found: ${artifact}"

  log "Restoring ${path} for ${service}"
  compose run --rm --no-deps -T --entrypoint sh "${service}" -c \
    'set -e; find "$1" -mindepth 1 -maxdepth 1 -exec rm -rf {} +; tar xzf - -C "$1"' \
    sh "${path}" <"${artifact}"
}

volume_artifact() {
  local name="$1"
  if [ -f "${SET_DIR}/documents/${name}.tar.gz.gpg" ]; then
    echo "${SET_DIR}/documents/${name}.tar.gz.gpg"
  elif [ -f "${SET_DIR}/documents/${name}.tar.gz" ]; then
    echo "${SET_DIR}/documents/${name}.tar.gz"
  else
    echo ""
  fi
}

require_volume_artifact() {
  local name="$1"
  local source target

  source="$(volume_artifact "${name}")"
  [ -n "${source}" ] || die "The selected backup set has no ${name} archive"

  target="${TMP_DIR}/${name}.tar.gz"
  decrypt_artifact "${source}" "${target}"
  printf '%s' "${target}"
}

verify_volume_archives() {
  local name source target

  command -v tar >/dev/null 2>&1 || {
    log "tar is unavailable; skipping archive verification"
    return
  }

  for name in storage uploads; do
    source="$(volume_artifact "${name}")"
    if [ -z "${source}" ]; then
      log "No ${name} archive in this backup set; skipping"
      continue
    fi

    target="${TMP_DIR}/${name}-drill.tar.gz"
    decrypt_artifact "${source}" "${target}"
    tar tzf "${target}" >/dev/null || die "Archive ${source} is unreadable"
    log "Archive ${name} decrypted and readable"
    rm -f "${target}"
  done
}

if [ "${IN_PLACE}" = "true" ]; then
  if [ "${ASSUME_YES}" != "true" ]; then
    printf 'This replaces the live databases and document volumes from %s.\n' "${SET_DIR}" >&2
    printf 'Type the backup timestamp to continue: ' >&2
    read -r confirmation
    [ "${confirmation}" = "$(basename "${SET_DIR}")" ] ||
      die "Confirmation did not match; nothing was changed"
  fi

  log "Stopping application services"
  compose stop auth-service user-service kyc-service frontend || true

  log "Creating a safety backup before restoring"
  COMPOSE_FILE="${COMPOSE_FILE}" BACKUP_SKIP_DOCUMENTS=false \
    "${SCRIPT_DIR}/backup.sh"

  for db in "${DATABASES[@]}"; do
    restore_database "${db}" "${db}"
  done

  storage_archive="$(require_volume_artifact storage)"
  restore_volume kyc-service /app/storage "${storage_archive}"

  uploads_archive="$(require_volume_artifact uploads)"
  restore_volume user-service /app/uploads "${uploads_archive}"

  if [ "${RUN_MIGRATIONS}" = "true" ]; then
    user="$(urlencode "$(postgres_env POSTGRES_USER)")"
    password="$(urlencode "$(postgres_env POSTGRES_PASSWORD)")"
    for entry in "auth-service:auth_db" "user-service:user_db" "kyc-service:kyc_db"; do
      service="${entry%%:*}"
      db="${entry##*:}"
      log "Applying migrations to ${db}"
      compose run --rm --no-deps -T \
        -e DATABASE_URL="postgresql://${user}:${password}@postgres:5432/${db}?schema=public" \
        "${service%-service}-migrate"
    done
  fi

  log "Starting application services"
  compose up -d

  healthy="false"
  for _ in $(seq 1 30); do
    if compose exec -T user-service node -e \
      "fetch('http://127.0.0.1:5002/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" \
      >/dev/null 2>&1; then
      healthy="true"
      break
    fi
    sleep 2
  done
  if [ "${healthy}" != "true" ]; then
    log "WARNING: user-service did not become healthy within 60 seconds"
  fi

  if [ "${VERIFY_LEDGER}" = "true" ]; then
    ledger_verify user_db
  fi

  log "In-place restore complete; verify sign-in, wallets, and KYC documents"
  exit 0
fi

verify_volume_archives

RESTORED=()
for db in "${DATABASES[@]}"; do
  target="${db}${SUFFIX}"
  restore_database "${db}" "${target}"
  RESTORED+=("${target}")
done

if [ "${VERIFY_LEDGER}" = "true" ]; then
  ledger_verify "user_db${SUFFIX}"
fi

if [ "${KEEP_RESTORED}" = "true" ]; then
  log "Keeping restored databases: ${RESTORED[*]}"
else
  for target in "${RESTORED[@]}"; do
    log "Dropping drill database ${target}"
    drop_database "${target}"
  done
fi

log "Restore drill passed"
