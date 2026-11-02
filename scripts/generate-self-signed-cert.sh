#!/usr/bin/env bash
# Generates a self-signed certificate for local or staging TLS testing.
# Production deployments should use a CA-issued certificate (see
# docs/deployment-guide.md). The frontend container reads certs/tls.crt and
# certs/tls.key.
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: scripts/generate-self-signed-cert.sh [--force] [OUTPUT_DIR]

  --force       overwrite an existing tls.crt / tls.key pair
  OUTPUT_DIR    destination directory (default: certs)

Environment:
  CERT_HOSTNAME  primary DNS name (default: localhost)
  CERT_DAYS      validity in days (default: 825)
EOF
}

FORCE=0
if [ "${1:-}" = "--force" ]; then
    FORCE=1
    shift
fi
if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    usage
    exit 0
fi

OUT_DIR="${1:-certs}"
HOST="${CERT_HOSTNAME:-localhost}"
DAYS="${CERT_DAYS:-825}"

command -v openssl >/dev/null 2>&1 || {
    echo "openssl is required." >&2
    exit 1
}

if [ "$FORCE" -eq 0 ] && { [ -e "$OUT_DIR/tls.crt" ] || [ -e "$OUT_DIR/tls.key" ]; }; then
    echo "Refusing to overwrite $OUT_DIR/tls.crt or $OUT_DIR/tls.key; pass --force." >&2
    exit 1
fi

mkdir -p "$OUT_DIR"
umask 077

if [ "$HOST" = "localhost" ]; then
    SAN="DNS:localhost,IP:127.0.0.1"
else
    SAN="DNS:$HOST,DNS:localhost,IP:127.0.0.1"
fi

# Use a temporary config for the subject instead of -subj: Git Bash rewrites
# -subj "/CN=..." into a Windows path.
CONFIG="$(mktemp)"
trap 'rm -f "$CONFIG"' EXIT
cat > "$CONFIG" <<EOF
[req]
prompt = no
distinguished_name = dn

[dn]
CN = $HOST
EOF

openssl req -x509 -nodes -newkey rsa:4096 -sha256 -days "$DAYS" \
    -config "$CONFIG" \
    -keyout "$OUT_DIR/tls.key" \
    -out "$OUT_DIR/tls.crt" \
    -addext "subjectAltName=$SAN"

chmod 600 "$OUT_DIR/tls.key"
chmod 644 "$OUT_DIR/tls.crt"

echo "Wrote $OUT_DIR/tls.crt and $OUT_DIR/tls.key."
echo "Self-signed certificates are for local/staging testing only."
openssl x509 -in "$OUT_DIR/tls.crt" -noout -subject -dates
