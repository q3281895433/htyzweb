#!/usr/bin/env bash
set -euo pipefail

candidate=${1:?Provide the new Nginx config path}
live=/etc/nginx/sites-available/htyz
backup=/var/backups/htyz/nginx-htyz-$(date -u +%Y%m%dT%H%M%SZ).conf

test -f "$candidate"
test -f "$live"
mkdir -p /var/backups/htyz
cp "$live" "$backup"
cp "$candidate" "$live"
if ! nginx -t; then
  cp "$backup" "$live"
  nginx -t
  echo "Nginx config validation failed; restored $backup" >&2
  exit 1
fi
systemctl reload nginx
echo "Nginx config updated; previous config: $backup"
