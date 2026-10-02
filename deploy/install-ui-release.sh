#!/usr/bin/env bash
set -euo pipefail
archive=${1:?Pass the trusted dist-only archive}
test -f "$archive"
test -f /opt/htyz/dist/index.html
gzip -t "$archive"
stage=$(mktemp -d /opt/htyz-ui-stage.XXXXXX)
tar -xzf "$archive" -C "$stage"
test -s "$stage/dist/index.html"
test -d "$stage/dist/assets"
backup=$(mktemp -d /var/backups/htyz/ui-particles.XXXXXX)
cp -a /opt/htyz/dist "$backup/dist"
rollback() {
  cp -p "$backup/dist/index.html" /opt/htyz/dist/index.rollback.html
  mv -f /opt/htyz/dist/index.rollback.html /opt/htyz/dist/index.html
  printf 'UI release failed; prior index restored. Backup: %s\n' "$backup" >&2
}
trap rollback ERR
# Keep old hashed assets so already-open pages continue working.
cp -a "$stage/dist/assets/." /opt/htyz/dist/assets/
install -m 644 "$stage/dist/index.html" /opt/htyz/dist/index.next.html
mv -f /opt/htyz/dist/index.next.html /opt/htyz/dist/index.html
curl --fail --silent --max-time 10 http://127.0.0.1:3000/api/health >/dev/null
cmp "$stage/dist/index.html" /opt/htyz/dist/index.html
trap - ERR
printf 'UI release completed. Backup: %s\nStage: %s\n' "$backup" "$stage"
