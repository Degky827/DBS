#!/usr/bin/env bash
# Certbot deploy hook: copies the renewed certificate into the Compose
# certificate directory and reloads Nginx. Invoked by certbot with
# RENEWED_LINEAGE pointing at /etc/letsencrypt/live/<domain>.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/banking-system}"
LINEAGE="${RENEWED_LINEAGE:-}"
[ -n "$LINEAGE" ] || { echo "RENEWED_LINEAGE is not set." >&2; exit 1; }
[ -d "$APP_DIR" ] || { echo "App directory not found: $APP_DIR" >&2; exit 1; }

install -m 644 "$LINEAGE/fullchain.pem" "$APP_DIR/certs/tls.crt"
install -m 600 "$LINEAGE/privkey.pem" "$APP_DIR/certs/tls.key"

docker compose --project-directory "$APP_DIR" -f "$APP_DIR/docker-compose.yml" \
    exec -T frontend nginx -s reload >/dev/null 2>&1 || true

echo "[renew-cert] copied certificate from $LINEAGE and reloaded Nginx"
