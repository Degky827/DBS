#!/bin/sh
set -e

# A named volume keeps whatever ownership it had when Docker first created it,
# even if a later image changed the directory owner. Re-apply ownership on every
# start so the non-root runtime user can always write uploads.
mkdir -p "${AVATAR_UPLOAD_DIR:-/app/uploads/avatars}"
chown -R node:node /app/uploads

exec su-exec node "$@"
