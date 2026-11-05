#!/usr/bin/env bash
# First deployment (and repeat deployment) of the Compose stack on a fresh
# Ubuntu VM. Run as root from a checkout of this repository:
#
#   sudo BREVO_API_KEY_FILE=/root/brevo.key \
#     /opt/banking-system/deploy/oracle/bootstrap.sh \
#       --domain bank.example.com --email ops@example.com
#
# The script never prints secret values and never overwrites an existing .env.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Degky827/DBS.git}"
BRANCH="${BRANCH:-dev}"
APP_DIR="${APP_DIR:-/opt/banking-system}"
DOMAIN=""
EMAIL=""
SKIP_TLS=0

usage() {
    cat <<'EOF'
Usage: bootstrap.sh --domain HOST --email ADDRESS [options]

  --domain HOST     public DNS name pointed at this VM (required)
  --email ADDRESS   Let's Encrypt contact address (required unless --skip-tls)
  --repo URL        git remote (default https://github.com/Degky827/DBS.git)
  --branch NAME     branch to deploy (default dev)
  --app-dir DIR     destination checkout (default /opt/banking-system)
  --skip-tls        reuse existing certs/tls.crt and certs/tls.key
  -h, --help        show this help

Environment:
  BREVO_API_KEY_FILE   root-only file with the Brevo API key (first run only)
  BREVO_API_KEY        same value inline (first run only; avoid, visible in env)
  COMPOSE_PARALLEL_LIMIT  build concurrency (default 1 to bound RAM use)
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --domain) DOMAIN="${2:-}"; shift 2 ;;
        --email) EMAIL="${2:-}"; shift 2 ;;
        --repo) REPO_URL="${2:-}"; shift 2 ;;
        --branch) BRANCH="${2:-}"; shift 2 ;;
        --app-dir) APP_DIR="${2:-}"; shift 2 ;;
        --skip-tls) SKIP_TLS=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
    esac
done

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
[ -n "$DOMAIN" ] || { echo "--domain is required." >&2; exit 2; }
if [ "$SKIP_TLS" -eq 0 ] && [ -z "$EMAIL" ]; then
    echo "--email is required for Let's Encrypt issuance." >&2
    exit 2
fi

require() {
    command -v "$1" >/dev/null 2>&1 || { echo "$1 is required but missing." >&2; exit 1; }
}
for tool in git docker curl openssl ss python3 certbot; do require "$tool"; done
docker compose version >/dev/null 2>&1 || {
    echo "docker compose plugin is missing. Re-run cloud-init or install docker-compose-plugin." >&2
    exit 1
}

echo "==> Fetching $REPO_URL ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" remote set-url origin "$REPO_URL"
    git -C "$APP_DIR" fetch origin "$BRANCH"
    git -C "$APP_DIR" checkout "$BRANCH"
    git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
    mkdir -p "$(dirname "$APP_DIR")"
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

# Updates a non-secret key in place. Secret keys are left untouched.
set_env() {
    local key="$1" value="$2"
    if grep -q "^${key}=" .env; then
        sed -i "s|^${key}=.*|${key}=${value}|" .env
    else
        printf '%s=%s\n' "$key" "$value" >> .env
    fi
}

if [ ! -f .env ]; then
    echo "==> No .env found; generating one with new secrets"
    bash ./deploy/oracle/generate-env.sh --app-dir "$APP_DIR" --domain "$DOMAIN"
else
    echo "==> Keeping existing .env (secrets preserved)"
    chmod 600 .env
fi
set_env APP_ORIGIN "https://$DOMAIN"
set_env TLS_ENABLED "true"
set_env FRONTEND_HTTP_PORT "80"
set_env FRONTEND_HTTPS_PORT "443"
if grep -q '^CHAPA_CALLBACK_URL=.' .env; then
    set_env CHAPA_CALLBACK_URL "https://$DOMAIN/api/user/payments/chapa/callback"
    set_env CHAPA_RETURN_URL "https://$DOMAIN/wallet"
fi

mkdir -p certs certbot/www
if [ ! -s certs/tls.crt ] || [ ! -s certs/tls.key ]; then
    if [ "$SKIP_TLS" -eq 1 ]; then
        echo "No certificate in certs/ and --skip-tls was given." >&2
        exit 1
    fi
    echo "==> Requesting a Let's Encrypt certificate for $DOMAIN"
    if ss -ltn '( sport = :80 )' | grep -q LISTEN; then
        echo "Port 80 is already in use; stop the listener before issuing a certificate." >&2
        exit 1
    fi
    # The ACME HTTP-01 challenge needs a listener on port 80. The stack is not
    # started yet, so serve the webroot with Python until certbot finishes.
    ( cd certbot/www && python3 -m http.server 80 --bind 0.0.0.0 ) >/dev/null 2>&1 &
    HTTP_PID=$!
    trap 'kill "$HTTP_PID" 2>/dev/null || true' EXIT
    sleep 2
    certbot certonly --webroot -w "$APP_DIR/certbot/www" \
        -d "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive \
        --deploy-hook "bash $APP_DIR/deploy/oracle/renew-cert.sh"
    kill "$HTTP_PID" 2>/dev/null || true
    wait "$HTTP_PID" 2>/dev/null || true
    trap - EXIT
    install -m 644 "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" certs/tls.crt
    install -m 600 "/etc/letsencrypt/live/$DOMAIN/privkey.pem" certs/tls.key
    systemctl enable --now certbot.timer >/dev/null 2>&1 || true
fi

echo "==> Building images (sequential: COMPOSE_PARALLEL_LIMIT=1)"
export COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-1}"
docker compose -f docker-compose.yml build

echo "==> Starting the stack"
docker compose -f docker-compose.yml up -d --remove-orphans

echo "==> Waiting for the public HTTPS endpoint"
ready=0
for _ in $(seq 1 90); do
    if curl -fsS --max-time 5 --resolve "$DOMAIN:443:127.0.0.1" \
        "https://$DOMAIN/healthz" >/dev/null 2>&1; then
        ready=1
        break
    fi
    sleep 10
done

if [ "$ready" -ne 1 ]; then
    echo "The stack did not become reachable within 15 minutes." >&2
    docker compose -f docker-compose.yml ps >&2
    echo "Inspect logs with: cd $APP_DIR && docker compose logs --tail=100" >&2
    exit 1
fi

echo "==> Verifying"
APP_DIR="$APP_DIR" DOMAIN="$DOMAIN" bash ./deploy/oracle/verify.sh

cat <<EOF

Deployment complete: https://$DOMAIN
Next steps:
  - Register the first account in the browser.
  - Optional: elevate it with
      docker compose exec -T postgres psql -U <POSTGRES_USER> -d auth_db \\
        -c "UPDATE \\"User\\" SET role='ADMIN' WHERE email='<address>';"
  - Schedule off-host database backups (see docs/deployment/backup-and-recovery.md).
EOF
