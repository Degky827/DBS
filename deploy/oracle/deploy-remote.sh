#!/usr/bin/env bash
# Runs on the workstation: copies this bundle and the Brevo key to a fresh
# Oracle VM, then runs bootstrap.sh there. Nothing secret is printed or passed
# on a command line.
#
#   ./deploy/oracle/deploy-remote.sh \
#     --host 129.146.10.20 \
#     --domain bank.example.com \
#     --email ops@example.com \
#     --brevo-key-file ~/.secrets/brevo.key
set -euo pipefail

HOST=""
SSH_USER="ubuntu"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/banking-oracle}"
DOMAIN=""
EMAIL=""
BREVO_KEY_FILE=""
EMAIL_FROM_EMAIL=""
BRANCH="${BRANCH:-dev}"
REPO_URL="${REPO_URL:-https://github.com/Degky827/DBS.git}"
APP_DIR="/opt/banking-system"

usage() {
    cat <<'EOF'
Usage: deploy-remote.sh --host ADDRESS --domain HOST --email ADDRESS \
         --brevo-key-file FILE [options]

  --host ADDRESS          public IP or DNS name of the VM (required)
  --domain HOST           public DNS name served by the VM (required)
  --email ADDRESS         Let's Encrypt contact address (required)
  --brevo-key-file FILE   local file with the Brevo key (required, first run)
  --email-from ADDRESS    verified Brevo sender address
  --ssh-user NAME         default ubuntu
  --ssh-key FILE          default ~/.ssh/banking-oracle
  --branch NAME           default dev
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --host) HOST="${2:-}"; shift 2 ;;
        --domain) DOMAIN="${2:-}"; shift 2 ;;
        --email) EMAIL="${2:-}"; shift 2 ;;
        --brevo-key-file) BREVO_KEY_FILE="${2:-}"; shift 2 ;;
        --email-from) EMAIL_FROM_EMAIL="${2:-}"; shift 2 ;;
        --ssh-user) SSH_USER="${2:-}"; shift 2 ;;
        --ssh-key) SSH_KEY="${2:-}"; shift 2 ;;
        --branch) BRANCH="${2:-}"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
    esac
done

for required in HOST DOMAIN EMAIL BREVO_KEY_FILE; do
    [ -n "${!required}" ] || { echo "--${required,,} is required." >&2; exit 2; }
done
case "$DOMAIN" in
    *[!A-Za-z0-9.-]*|.*|*.) echo "Invalid domain: $DOMAIN" >&2; exit 2 ;;
esac
case "$EMAIL" in
    *@*.*) ;;
    *) echo "Invalid email address: $EMAIL" >&2; exit 2 ;;
esac
[ -r "$SSH_KEY" ] || { echo "SSH key not readable: $SSH_KEY" >&2; exit 1; }
[ -r "$BREVO_KEY_FILE" ] || { echo "Brevo key file not readable: $BREVO_KEY_FILE" >&2; exit 1; }
command -v ssh >/dev/null && command -v scp >/dev/null && command -v tar >/dev/null || {
    echo "ssh, scp, and tar are required." >&2
    exit 1
}

SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
TARGET="$SSH_USER@$HOST"
q() { printf '%q' "$1"; }

echo "==> Checking SSH to $TARGET"
ssh "${SSH_OPTS[@]}" "$TARGET" true

echo "==> Copying the deployment bundle"
tar -C "$(dirname "$0")/.." -czf - oracle | \
    ssh "${SSH_OPTS[@]}" "$TARGET" \
        'rm -rf /tmp/banking-deploy && mkdir -p /tmp/banking-deploy && tar -xzf - -C /tmp/banking-deploy'

echo "==> Copying the Brevo key (root-only on the VM)"
scp -q "${SSH_OPTS[@]}" "$BREVO_KEY_FILE" "$TARGET:/tmp/banking-brevo.key"
ssh "${SSH_OPTS[@]}" "$TARGET" \
    'sudo install -m 600 /tmp/banking-brevo.key /root/brevo.key && rm -f /tmp/banking-brevo.key'

echo "==> Preparing $APP_DIR and running bootstrap"
setup="set -e
if [ ! -d $(q "$APP_DIR/.git") ]; then
  sudo mkdir -p $(q "$(dirname "$APP_DIR")")
  sudo git clone --branch $(q "$BRANCH") $(q "$REPO_URL") $(q "$APP_DIR")
fi
sudo mkdir -p $(q "$APP_DIR/deploy/oracle")
sudo cp -a /tmp/banking-deploy/oracle/. $(q "$APP_DIR/deploy/oracle/")
"
ssh "${SSH_OPTS[@]}" "$TARGET" "$setup"

run="sudo BREVO_API_KEY_FILE=/root/brevo.key"
if [ -n "$EMAIL_FROM_EMAIL" ]; then
    run="$run EMAIL_FROM_EMAIL=$(q "$EMAIL_FROM_EMAIL")"
fi
run="$run bash $(q "$APP_DIR/deploy/oracle/bootstrap.sh") \
--domain $(q "$DOMAIN") --email $(q "$EMAIL") --branch $(q "$BRANCH")"
ssh "${SSH_OPTS[@]}" "$TARGET" "$run"

echo
echo "Public URL: https://$DOMAIN"
