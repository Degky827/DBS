#!/bin/sh
set -e

# A named volume keeps whatever ownership it had when Docker first created it,
# even if a later image changed the directory owner. Re-apply ownership on every
# start so the non-root runtime user can always write stored documents.
mkdir -p "${STORAGE_DIR:-/app/storage}"
chown -R node:node "${STORAGE_DIR:-/app/storage}"

exec su-exec node "$@"
