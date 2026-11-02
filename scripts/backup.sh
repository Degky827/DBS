#!/usr/bin/env bash
#
# Creates an encrypted-at-rest backup set for the Meridian stack.
#
# The set contains a custom-format pg_dump for each service database, tar
# archives of the KYC document and avatar volumes, and a SHA-256 manifest.
#
# Usage:
#   ./scripts/backup.sh
#   COMPOSE_FILE=docker-compose.dev.yml ./scripts/backup.sh
#
# Environment:
#   COMPOSE_FILE                 Compose file to use (default: docker-compose.yml)
#   BACKUP_ROOT                  Output root (default: <repo>/backups)
#   BACKUP_RETENTION_DAYS        Daily set retention (default: 30, 0 disables)
#   BACKUP_GPG_RECIPIENT         Encrypt every artifact with this GPG key
#   BACKUP_REQUIRE_ENCRYPTION    "true" fails when no recipient is configured
#   BACKUP_SKIP_DOCUMENTS        "true" skips document/upload volume archives
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

COMPOSE_FILE="${COMPOSE_FILE:-${REPO_ROOT}/docker-compose.yml}"
BACKUP_ROOT="${BACKUP_ROOT:-${REPO_ROOT}/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
GPG_RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"
REQUIRE_ENCRYPTION="${BACKUP_REQUIRE_ENCRYPTION:-false}"
SKIP_DOCUMENTS="${BACKUP_SKIP_DOCUMENTS:-false}"
DATABASES=(auth_db user_db kyc_db)
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SET_DIR="${BACKUP_ROOT}/sets/${STAMP}"

log() { printf '[backup] %s\n' "$*" >&2; }
die() {
  printf '[backup] ERROR: %s\n' "$*" >&2
  exit 1
}

compose() {
  docker compose -f "${COMPOSE_FILE}" "$@"
}

if [ "${REQUIRE_ENCRYPTION}" = "true" ] && [ -z "${GPG_RECIPIENT}" ]; then
  die "BACKUP_REQUIRE_ENCRYPTION=true but BACKUP_GPG_RECIPIENT is empty"
fi

if [ -n "${GPG_RECIPIENT}" ]; then
  command -v gpg >/dev/null 2>&1 || die "gpg is required for encrypted backups"
fi

case "${BACKUP_ROOT}" in
  "" | "/" | "." | "..")
    die "Refusing to use BACKUP_ROOT=${BACKUP_ROOT}"
    ;;
esac

[ -f "${COMPOSE_FILE}" ] || die "Compose file not found: ${COMPOSE_FILE}"
command -v docker >/dev/null 2>&1 || die "docker is required"

mkdir -p "${SET_DIR}/postgres" "${SET_DIR}/documents"
chmod 700 "${BACKUP_ROOT}" "${BACKUP_ROOT}/sets" "${SET_DIR}"

log "Starting backup set ${STAMP}"

compose ps --status running --services | grep -qx "postgres" ||
  die "postgres container is not running"

# Pipes a dump through the postgres container so database credentials never
# need to be read on the host.
dump_database() {
  local db="$1"
  local output="${SET_DIR}/postgres/${db}.dump"

  log "Dumping ${db}"
  compose exec -T postgres sh -c \
    'pg_dump -U "$POSTGRES_USER" -Fc -Z 9 --no-owner --no-privileges "$1"' \
    sh "${db}" >"${output}"

  [ -s "${output}" ] || die "pg_dump produced an empty file for ${db}"

  # A custom-format archive that cannot be listed is unusable; catch that now
  # rather than during a restore.
  compose exec -T postgres pg_restore --list <"${output}" >/dev/null ||
    die "pg_restore could not read the ${db} dump"

  echo "${output}"
}

# Archives a named Compose volume through a one-off container, so the backup
# still works when the owning service is stopped.
archive_service_path() {
  local service="$1"
  local path="$2"
  local output="${SET_DIR}/documents/$(basename "${path}").tar.gz"

  log "Archiving ${service}:${path}"
  compose run --rm --no-deps -T --entrypoint tar "${service}" \
    czf - -C "${path}" . >"${output}"

  [ -s "${output}" ] || die "Empty archive for ${service}:${path}"

  gzip -t "${output}" || die "Archive for ${service}:${path} is corrupt"

  echo "${output}"
}

encrypt_artifact() {
  local file="$1"

  if [ -z "${GPG_RECIPIENT}" ]; then
    echo "${file}"
    return
  fi

  gpg --batch --yes --quiet --trust-model always \
    --recipient "${GPG_RECIPIENT}" --output "${file}.gpg" --encrypt "${file}" ||
    die "Encryption failed for ${file}"

  rm -f "${file}"
  echo "${file}.gpg"
}

ENTRIES_TMP="$(mktemp)"
FIRST_ENTRY=1

record_artifact() {
  local file="$1"
  local relative="${file#"${SET_DIR}/"}"
  local bytes sha

  bytes="$(wc -c <"${file}" | tr -d ' \r\n')"
  sha="$(sha256sum "${file}" | awk '{print $1}')"

  if [ "${FIRST_ENTRY}" -eq 1 ]; then
    FIRST_ENTRY=0
  else
    printf ',\n' >>"${ENTRIES_TMP}"
  fi
  printf '    {"path": "%s", "bytes": %s, "sha256": "%s"}' \
    "${relative}" "${bytes}" "${sha}" >>"${ENTRIES_TMP}"
}

for db in "${DATABASES[@]}"; do
  artifact="$(encrypt_artifact "$(dump_database "${db}")")"
  record_artifact "${artifact}"
done

if [ "${SKIP_DOCUMENTS}" != "true" ]; then
  artifact="$(encrypt_artifact "$(archive_service_path kyc-service /app/storage)")"
  record_artifact "${artifact}"
  artifact="$(encrypt_artifact "$(archive_service_path user-service /app/uploads)")"
  record_artifact "${artifact}"
else
  log "Skipping document archives (BACKUP_SKIP_DOCUMENTS=true)"
fi

(
  cd "${SET_DIR}"
  find postgres documents -type f -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS
)

DATABASES_JSON=""
for db in "${DATABASES[@]}"; do
  [ -z "${DATABASES_JSON}" ] || DATABASES_JSON+=", "
  DATABASES_JSON+="\"${db}\""
done

{
  printf '{\n'
  printf '  "timestamp": "%s",\n' "${STAMP}"
  printf '  "createdAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "composeFile": "%s",\n' "$(basename "${COMPOSE_FILE}")"
  printf '  "databases": [%s],\n' "${DATABASES_JSON}"
  printf '  "encrypted": %s,\n' "$([ -n "${GPG_RECIPIENT}" ] && echo true || echo false)"
  printf '  "gpgRecipient": %s,\n' "$([ -n "${GPG_RECIPIENT}" ] && printf '"%s"' "${GPG_RECIPIENT}" || echo null)"
  printf '  "files": [\n'
  cat "${ENTRIES_TMP}"
  printf '\n  ]\n'
  printf '}\n'
} >"${SET_DIR}/manifest.json"

rm -f "${ENTRIES_TMP}"
chmod 700 "${SET_DIR}" "${SET_DIR}/postgres" "${SET_DIR}/documents"
find "${SET_DIR}" -type f -exec chmod 600 {} +

log "Backup set complete: ${SET_DIR}"

if [ "${RETENTION_DAYS}" -gt 0 ] 2>/dev/null; then
  log "Pruning backup sets older than ${RETENTION_DAYS} days"
  find "${BACKUP_ROOT}/sets" -mindepth 1 -maxdepth 1 -type d \
    ! -path "${SET_DIR}" -mtime +"${RETENTION_DAYS}" \
    -print -exec rm -rf -- {} + || true
fi

log "Done"
