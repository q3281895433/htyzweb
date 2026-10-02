#!/usr/bin/env bash
set -euo pipefail

archive=${1:?Provide the release archive path}
site_dir=/opt/htyz
stage_dir=$(mktemp -d /opt/htyz-stage.XXXXXX)
backup_dir=/var/backups/htyz/$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$backup_dir"

test -f "$archive"
test -f "$site_dir/.env"
test -d "$site_dir/data"
test -d "$site_dir/uploads"
tar -xzf "$archive" -C "$stage_dir"
test -f "$stage_dir/dist/index.html"
test -f "$stage_dir/server/index.js"
test -f "$stage_dir/package.json"
node --check "$stage_dir/server/index.js"

systemctl stop htyz
old_items=(dist server deploy package.json package-lock.json src tests index.html vite.config.js .env.example .gitignore .impeccable API_ENDPOINTS.md DESIGN.md DIRECTION.md PRODUCT.md QUALITY_BAR.md)
for item in "${old_items[@]}"; do
  if test -e "$site_dir/$item"; then
    mv "$site_dir/$item" "$backup_dir/$item"
  fi
done

for item in dist server deploy package.json package-lock.json; do
  mv "$stage_dir/$item" "$site_dir/$item"
done
# 用 rm -rf 而不是 rmdir：stage 目录里可能残留打包时带入的其他文件，
# rmdir 失败会让整个脚本以非零状态退出，看起来像发布失败（实际服务已正常启动）。
rm -rf "$stage_dir"
# 规范化权限：本地文件可能是 0600（受 umask 影响），若原样保留，
# htyz 服务用户将无法读取代码，服务会启动失败。
find "$site_dir/dist" "$site_dir/server" "$site_dir/deploy" -type d -exec chmod 755 {} \;
find "$site_dir/dist" "$site_dir/server" "$site_dir/deploy" -type f -exec chmod 644 {} \;
chmod 644 "$site_dir/package.json" "$site_dir/package-lock.json"
chown -R root:htyz "$site_dir/dist" "$site_dir/server" "$site_dir/deploy"
chown root:htyz "$site_dir/package.json" "$site_dir/package-lock.json"
systemctl start htyz

healthy=false
for attempt in {1..15}; do
  if curl --fail --silent --max-time 2 http://127.0.0.1:3000/api/health >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done
if test "$healthy" != true; then
  systemctl stop htyz || true
  for item in dist server deploy package.json package-lock.json; do
    mv "$site_dir/$item" "$backup_dir/new-$item"
    mv "$backup_dir/$item" "$site_dir/$item"
  done
  systemctl start htyz
  echo "Release failed health check; restored prior running version. Backup: $backup_dir" >&2
  exit 1
fi

echo "Release installed; previous website files are outside the live directory at $backup_dir"
