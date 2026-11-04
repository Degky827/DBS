#!/usr/bin/env bash
# Create and migrate the databases the backend suites expect.
#
# Development only. It targets the local Compose stack and refuses anything
# whose host is not postgres inside the Compose network.
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.dev.yml}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-banking-system}"
PG_SERVICE="${PG_SERVICE:-postgres}"
PG_USER="${POSTGRES_USER:-meridian}"
PG_PASSWORD="${POSTGRES_PASSWORD:-dev-only-postgres-password}"

# database: migrate service that owns its schema
declare -A TEST_DATABASES=(
  [auth_test]=auth-migrate
  [user_test]=user-migrate
  [kyc_test]=kyc-migrate
  [notification_test]=notification-migrate
)

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

for db in "${!TEST_DATABASES[@]}"; do
  exists="$(compose exec -T "$PG_SERVICE" \
    psql -U "$PG_USER" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname='${db}'" | tr -d '[:space:]')"

  if [ "$exists" = "1" ]; then
    echo "database exists: ${db}"
  else
    echo "creating database: ${db}"
    compose exec -T "$PG_SERVICE" psql -U "$PG_USER" -d postgres \
      -c "CREATE DATABASE \"${db}\";"
  fi

  echo "applying migrations to: ${db}"
  compose run --rm -T \
    -e "DATABASE_URL=postgresql://${PG_USER}:${PG_PASSWORD}@postgres:5432/${db}?schema=public" \
    "${TEST_DATABASES[$db]}"
done

echo "test databases ready: ${!TEST_DATABASES[*]}"
