#!/bin/sh
# Selects the TLS or HTTP-only Nginx configuration. Runs from the official
# nginx image entrypoint after the stock /docker-entrypoint.d scripts.
set -eu

TLS_MODE="${TLS_ENABLED:-auto}"
CONF_DIR="/etc/nginx/conf.d"
CERT_DIR="/etc/nginx/certs"

if [ "$TLS_MODE" = "auto" ]; then
    if [ -s "$CERT_DIR/tls.crt" ] && [ -s "$CERT_DIR/tls.key" ]; then
        TLS_MODE="true"
    else
        TLS_MODE="false"
    fi
fi

case "$TLS_MODE" in
    true|1|yes|on)
        if [ ! -s "$CERT_DIR/tls.crt" ] || [ ! -s "$CERT_DIR/tls.key" ]; then
            echo "[entrypoint] TLS_ENABLED requires $CERT_DIR/tls.crt and $CERT_DIR/tls.key." >&2
            exit 1
        fi
        cp /etc/nginx/banking/tls.conf "$CONF_DIR/default.conf"
        echo "[entrypoint] TLS enabled (certificate: $CERT_DIR/tls.crt)"
        ;;
    false|0|no|off)
        cp /etc/nginx/banking/http.conf "$CONF_DIR/default.conf"
        echo "[entrypoint] TLS disabled; serving plain HTTP behind a trusted TLS terminator."
        ;;
    *)
        echo "[entrypoint] Invalid TLS_ENABLED value: $TLS_MODE" >&2
        exit 1
        ;;
esac
