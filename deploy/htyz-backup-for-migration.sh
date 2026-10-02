#!/usr/bin/env bash
# ============================================================
#  htyz.space 迁移打包脚本
#
#  在【现有服务器】上运行，产出一个自包含的迁移包，
#  拿到【新服务器】后用 htyz-restore.sh 一条命令恢复。
#
#  用法：bash htyz-backup-for-migration.sh [输出目录]
#  默认输出到 /root/htyz-migration/
#
#  要点：
#   · 数据库用 SQLite 的 .backup 命令做一致性快照（直接 cp 活跃库可能损坏）
#   · 上传文件用 tar 打包，保留权限
#   · 一并带上 nginx / systemd / sysctl / 迁移说明
#   · 生成 SHA256 校验清单，便于核对传输完整性
# ============================================================
set -euo pipefail

OUT_DIR="${1:-/root/htyz-migration}"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d /tmp/htyz-migrate.XXXXXX)"
PKG="$WORK/htyz-migration-$STAMP"

SITE_DIR=/opt/htyz
DB="$SITE_DIR/data/htyz.db"

log() { printf '\033[36m▶\033[0m %s\n' "$*"; }
ok()  { printf '\033[32m✅\033[0m %s\n' "$*"; }
warn(){ printf '\033[33m⚠️\033[0m  %s\n' "$*"; }

mkdir -p "$PKG" "$OUT_DIR"

# ------------------------------------------------------------
# 1) 数据库一致性快照
# ------------------------------------------------------------
log "备份数据库（一致性快照）"
mkdir -p "$PKG/data"
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB" ".backup '$PKG/data/htyz.db'"
else
  # 没有 sqlite3 命令时用 Node 的 better-sqlite3 做 backup
  node -e "
    const Database = require('$SITE_DIR/node_modules/better-sqlite3');
    const db = new Database('$DB', { readonly: true });
    db.backup('$PKG/data/htyz.db').then(() => { console.log('  (通过 better-sqlite3 完成备份)'); db.close(); });
  "
fi
DB_SIZE=$(du -h "$PKG/data/htyz.db" | cut -f1)
ok "数据库快照完成（$DB_SIZE）"

# 校验快照可读且表数正确
TABLE_COUNT=$(sqlite3 "$PKG/data/htyz.db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';" 2>/dev/null || echo "?")
USER_COUNT=$(sqlite3 "$PKG/data/htyz.db" "SELECT COUNT(*) FROM users;" 2>/dev/null || echo "?")
ok "快照校验：$TABLE_COUNT 张表，$USER_COUNT 个用户"

# ------------------------------------------------------------
# 2) 上传文件
# ------------------------------------------------------------
log "打包上传文件"
tar -czf "$PKG/uploads.tar.gz" -C "$SITE_DIR" uploads
UP_SIZE=$(du -h "$PKG/uploads.tar.gz" | cut -f1)
UP_COUNT=$(find "$SITE_DIR/uploads" -type f | wc -l)
ok "上传文件打包完成（$UP_COUNT 个文件，压缩后 $UP_SIZE）"

# ------------------------------------------------------------
# 3) 应用代码与前端产物（用于核对，新机建议重新构建）
# ------------------------------------------------------------
log "打包应用代码与配置"
# 只打包实际存在的文件：生产机上可能没有 .env.example 等可选文件，
# 迁移工具必须能容忍缺失，不能因此中断整个备份。
APP_ITEMS=(server dist package.json)
for optional in package-lock.json .env.example; do
  if [ -e "$SITE_DIR/$optional" ]; then
    APP_ITEMS+=("$optional")
  else
    warn "跳过不存在的 $optional（不影响迁移）"
  fi
done
tar -czf "$PKG/app.tar.gz" -C "$SITE_DIR" "${APP_ITEMS[@]}"
ok "应用代码已打包（${APP_ITEMS[*]}）"

# ------------------------------------------------------------
# 4) 系统配置
# ------------------------------------------------------------
log "收集系统配置"
mkdir -p "$PKG/system"
cp -a /etc/nginx/sites-available/htyz "$PKG/system/nginx-htyz.conf" 2>/dev/null || warn "nginx 站点配置未找到"
cp -a /etc/systemd/system/htyz.service "$PKG/system/htyz.service" 2>/dev/null || warn "systemd unit 未找到"
cp -a /etc/sysctl.d/99-htyz-network.conf "$PKG/system/" 2>/dev/null || true

# Let's Encrypt 证书：新机建议重新签发，但保留一份以便应急
if [ -d /etc/letsencrypt ]; then
  tar -czf "$PKG/system/letsencrypt.tar.gz" -C / etc/letsencrypt 2>/dev/null || warn "证书打包失败（不影响）"
fi

# 环境配置（含 SMTP 密钥，注意保密）
cp -a "$SITE_DIR/.env" "$PKG/system/env.backup" 2>/dev/null || warn ".env 未找到"

# ------------------------------------------------------------
# 5) 环境信息（便于新机对齐版本）
# ------------------------------------------------------------
log "记录环境信息"
{
  echo "生成时间: $(date -Iseconds)"
  echo "源服务器: $(hostname)"
  echo
  echo "## 运行时版本"
  echo "Node:    $(node -v)"
  echo "npm:     $(npm -v 2>/dev/null || echo '?')"
  echo "SQLite:  $(sqlite3 --version 2>/dev/null | cut -d' ' -f1 || echo '?')"
  echo "ffmpeg:  $(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f3 || echo '未安装')"
  echo "nginx:   $(nginx -v 2>&1 | cut -d/ -f2 || echo '?')"
  echo "系统:    $(. /etc/os-release && echo "$PRETTY_NAME")"
  echo
  echo "## 数据规模"
  echo "用户:     $USER_COUNT"
  echo "上传文件: $UP_COUNT"
  echo "表数量:   $TABLE_COUNT"
  echo
  echo "## 需要在 .env 中确认的项"
  grep -E '^(SMTP_|MAIL_|ADMIN_CONTACT|SITE_ORIGIN|SESSION_DAYS)' "$SITE_DIR/.env" 2>/dev/null | sed 's/=.*/=<保持原值>/' || true
} > "$PKG/ENVIRONMENT.txt"
cat "$PKG/ENVIRONMENT.txt" | sed 's/^/    /'

# ------------------------------------------------------------
# 6) 校验清单
# ------------------------------------------------------------
log "生成校验清单"
( cd "$PKG" && find . -type f ! -name SHA256SUMS -exec sha256sum {} \; > SHA256SUMS )
ok "校验清单已生成（$(wc -l < "$PKG/SHA256SUMS") 个文件）"

# ------------------------------------------------------------
# 7) 打包
# ------------------------------------------------------------
log "打包迁移包"
ARCHIVE="$OUT_DIR/htyz-migration-$STAMP.tar.gz"
tar -czf "$ARCHIVE" -C "$WORK" "htyz-migration-$STAMP"
rm -rf "$WORK"

FINAL_SIZE=$(du -h "$ARCHIVE" | cut -f1)
echo
echo "════════════════════════════════════════════"
ok "迁移包已生成"
echo "  路径: $ARCHIVE"
echo "  大小: $FINAL_SIZE"
echo "  内容:"
tar -tzf "$ARCHIVE" | head -12 | sed 's/^/    /'
echo
echo "  下一步：把这个文件传到新服务器，然后运行 htyz-restore.sh"
echo "  注意：包含 .env（含 SMTP 授权码），传输时请用安全通道，用完及时删除"
echo "════════════════════════════════════════════"
