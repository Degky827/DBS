#!/bin/sh
# Starts the whole banking stack inside one Render web service:
# migrations -> optional demo seed -> four Node services -> Nginx gateway.
# Every child runs as the non-root `node` user.
set -eu

log() { printf '[render] %s\n' "$*"; }
fail() {
  printf '[render] ERROR: %s\n' "$*" >&2
  exit 1
}

PORT="${PORT:-10000}"
export PORT

# Render injects RENDER_EXTERNAL_URL. Services validate CORS_ORIGIN at startup,
# so derive it from the real public origin unless the operator pinned one.
if [ -z "${APP_ORIGIN:-}" ]; then
  APP_ORIGIN="${RENDER_EXTERNAL_URL:-http://localhost:${PORT}}"
fi
export APP_ORIGIN
if [ -z "${CORS_ORIGIN:-}" ]; then
  CORS_ORIGIN="$APP_ORIGIN"
fi
export CORS_ORIGIN
log "public origin: $APP_ORIGIN"

for variable in AUTH_DATABASE_URL USER_DATABASE_URL KYC_DATABASE_URL NOTIFICATION_DATABASE_URL; do
  eval "value=\${$variable:-}"
  [ -n "$value" ] || fail "$variable is required (one PostgreSQL database per service)"
done

run_migration() {
  service="$1"
  database_url="$2"
  ( cd "/app/services/$service" && DATABASE_URL="$database_url" \
      node /opt/migrator/node_modules/prisma/build/index.js migrate deploy )
}

log "applying Prisma migrations"
run_migration auth "$AUTH_DATABASE_URL" &
auth_migration=$!
run_migration user "$USER_DATABASE_URL" &
user_migration=$!
run_migration kyc "$KYC_DATABASE_URL" &
kyc_migration=$!
run_migration notification "$NOTIFICATION_DATABASE_URL" &
notification_migration=$!

migration_failed=0
for pid in "$auth_migration" "$user_migration" "$kyc_migration" "$notification_migration"; do
  wait "$pid" || migration_failed=1
done
[ "$migration_failed" -eq 0 ] || fail "one or more migrations failed; refusing to start"

if [ "${DEMO_SEED_ENABLED:-false}" = "true" ]; then
  log "seeding demonstration accounts"
  ( cd /app/services/auth && DATABASE_URL="$AUTH_DATABASE_URL" node prisma/seed.js ) \
    || fail "demo seeding failed"
fi

log "starting services"
PORT=5050 node /app/health.js &
health_pid=$!
DATABASE_URL="$AUTH_DATABASE_URL" PORT=5001 node /app/services/auth/server.js &
auth_pid=$!
DATABASE_URL="$USER_DATABASE_URL" PORT=5002 node /app/services/user/server.js &
user_pid=$!
DATABASE_URL="$KYC_DATABASE_URL" PORT=5003 node /app/services/kyc/server.js &
kyc_pid=$!
DATABASE_URL="$NOTIFICATION_DATABASE_URL" PORT=5004 node /app/services/notification/server.js &
notification_pid=$!

sed "s|__PORT__|${PORT}|g" /etc/nginx/banking/nginx.conf.template > /tmp/nginx.conf
nginx -c /tmp/nginx.conf -g "daemon off;" &
nginx_pid=$!

pids="$health_pid $auth_pid $user_pid $kyc_pid $notification_pid $nginx_pid"

stop_children() {
  log "shutting down"
  # shellcheck disable=SC2086
  kill -TERM $pids 2>/dev/null || true
  # shellcheck disable=SC2086
  wait $pids 2>/dev/null || true
}

trap 'stop_children; exit 0' TERM INT

while :; do
  for pid in $pids; do
    if ! kill -0 "$pid" 2>/dev/null; then
      log "process $pid exited unexpectedly; restarting the service"
      stop_children
      exit 1
    fi
  done
  sleep 3
done
