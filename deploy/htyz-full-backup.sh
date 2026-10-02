#!/usr/bin/env bash
# ============================================================
#  旧服务器（38.147.185.56）全量数据备份
#
#  备份内容：
#    · 数据库一致性快照（SQLite .backup，非直接拷贝）
#    · 全部上传文件
#    · 应用代码与前端产物
#    · 系统配置（nginx / systemd / sysctl）
#    · 环境配置（含 SMTP）
#    · 证书
#
#  产出：单个 tar.gz，带 SHA256 校验清单与恢复说明
# ============================================================
set -euo pipefail

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="/root/htyz-full-backup"
WORK="$(mktemp -d /tmp/htyz-fullbkp.XXXXXX)"
PKG="$WORK/htyz-full-backup-$STAMP"
SITE=/opt/htyz
DB="$SITE/data/htyz.db"

log(){ printf '\033[36m▶\033[0m %s\n' "$*"; }
ok(){  printf '\033[32m✅\033[0m %s\n' "$*"; }
warn(){ printf '\033[33m⚠️\033[0m  %s\n' "$*"; }

mkdir -p "$PKG" "$OUT_DIR"

echo "════════════════════════════════════════════"
echo "  旧服务器全量备份"
echo "  时间: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "  主机: $(hostname)"
echo "════════════════════════════════════════════"
echo

# ---------- 1) 数据库一致性快照 ----------
log "1/7 数据库一致性快照"
mkdir -p "$PKG/database"
sqlite3 "$DB" ".backup '$PKG/database/htyz.db'"
INTEG=$(sqlite3 "$PKG/database/htyz.db" 'PRAGMA integrity_check;')
USERS=$(sqlite3 "$PKG/database/htyz.db" 'SELECT COUNT(*) FROM users;')
TABLES=$(sqlite3 "$PKG/database/htyz.db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
ok "数据库: $TABLES 张表, $USERS 用户, 完整性 $INTEG"
[ "$INTEG" = "ok" ] || warn "数据库完整性检查未通过！"

# ---------- 2) 全部上传文件 ----------
log "2/7 全部上传文件"
tar -czf "$PKG/uploads.tar.gz" -C "$SITE" uploads
UP_COUNT=$(find "$SITE/uploads" -type f | wc -l)
UP_SIZE=$(du -h "$PKG/uploads.tar.gz" | cut -f1)
ok "上传文件: $UP_COUNT 个, 压缩后 $UP_SIZE"

# ---------- 3) 应用代码与前端 ----------
log "3/7 应用代码与前端产物"
APP_ITEMS=(server dist package.json)
for f in package-lock.json .env.example public; do
  [ -e "$SITE/$f" ] && APP_ITEMS+=("$f") || true
done
tar -czf "$PKG/app.tar.gz" -C "$SITE" "${APP_ITEMS[@]}"
ok "应用: ${APP_ITEMS[*]}"

# ---------- 4) 系统配置 ----------
log "4/7 系统配置"
mkdir -p "$PKG/system"
cp -a /etc/nginx/sites-available/htyz "$PKG/system/nginx-htyz.conf" 2>/dev/null || warn "nginx 配置缺失"
cp -a /etc/systemd/system/htyz.service "$PKG/system/htyz.service" 2>/dev/null || warn "systemd unit 缺失"
cp -a /etc/sysctl.d/99-htyz-network.conf "$PKG/system/" 2>/dev/null || true
cp -a /etc/logrotate.d/nginx "$PKG/system/logrotate-nginx" 2>/dev/null || true
ok "已收集 nginx / systemd / sysctl / logrotate"

# ---------- 5) 环境配置（含敏感信息）----------
log "5/7 环境配置"
cp -a "$SITE/.env" "$PKG/system/env.backup"
ok ".env 已备份（含 SMTP 授权码，注意保密）"

# ---------- 6) 证书 ----------
log "6/7 SSL 证书"
if [ -d /etc/letsencrypt ]; then
  tar -czhf "$PKG/system/letsencrypt.tar.gz" -C /etc letsencrypt 2>/dev/null || warn "证书打包失败"
  ok "证书已打包"
else
  warn "无 /etc/letsencrypt"
fi

# ---------- 7) 说明与校验 ----------
log "7/7 生成说明与校验清单"
cat > "$PKG/README-RESTORE.md" <<EOF
# 旧服务器全量备份

- **备份时间**：$(date '+%Y-%m-%d %H:%M:%S %Z')
- **来源主机**：$(hostname)
- **来源 IP**：38.147.185.56
- **数据规模**：$TABLES 张表 / $USERS 用户 / $UP_COUNT 个上传文件
- **数据库完整性**：$INTEG

## 内容

| 文件 | 说明 |
|---|---|
| \`database/htyz.db\` | 数据库一致性快照（可直接使用） |
| \`uploads.tar.gz\` | 全部用户上传文件（图片、视频） |
| \`app.tar.gz\` | 应用代码与前端构建产物 |
| \`system/nginx-htyz.conf\` | nginx 站点配置 |
| \`system/htyz.service\` | systemd 服务定义 |
| \`system/env.backup\` | 环境配置（**含 SMTP 授权码**） |
| \`system/letsencrypt.tar.gz\` | SSL 证书（含私钥） |
| \`system/99-htyz-network.conf\` | 网络调优参数 |
| \`SHA256SUMS\` | 完整性校验清单 |

## 恢复方法

\`\`\`bash
# 1) 校验
sha256sum -c SHA256SUMS

# 2) 恢复数据库
install -m 640 -o htyz -g htyz database/htyz.db /opt/htyz/data/htyz.db
sqlite3 /opt/htyz/data/htyz.db 'PRAGMA integrity_check;'   # 应输出 ok

# 3) 恢复上传文件
tar -xzf uploads.tar.gz -C /opt/htyz
chown -R htyz:htyz /opt/htyz/uploads

# 4) 恢复应用与配置
tar -xzf app.tar.gz -C /opt/htyz
cp system/nginx-htyz.conf /etc/nginx/sites-available/htyz
cp system/htyz.service /etc/systemd/system/
cp system/env.backup /opt/htyz/.env && chmod 640 /opt/htyz/.env

# 5) 证书（注意：需重建 certbot 要求的软链结构）
tar -xzf system/letsencrypt.tar.gz -C /
# live/ 下的文件必须是指向 archive/ 的软链，否则 certbot 无法续期

# 6) 启动
systemctl daemon-reload && systemctl restart htyz
\`\`\`

## ⚠️ 安全提示

本备份含**用户数据、SMTP 授权码、SSL 私钥**，请妥善保管，不要上传到公开位置。
EOF

( cd "$PKG" && find . -type f ! -name SHA256SUMS -exec sha256sum {} \; > SHA256SUMS )
ok "校验清单: $(wc -l < "$PKG/SHA256SUMS") 个文件"

# ---------- 打包 ----------
ARCHIVE="$OUT_DIR/htyz-full-backup-$STAMP.tar.gz"
tar -czf "$ARCHIVE" -C "$WORK" "htyz-full-backup-$STAMP"
rm -rf "$WORK"

echo
echo "════════════════════════════════════════════"
ok "全量备份完成"
echo "  路径: $ARCHIVE"
echo "  大小: $(du -h "$ARCHIVE" | cut -f1)"
echo "  SHA256: $(sha256sum "$ARCHIVE" | cut -d' ' -f1)"
echo
echo "  内容清单:"
tar -tzf "$ARCHIVE" | head -20 | sed 's/^/    /'
echo
echo "  恢复说明在包内 README-RESTORE.md"
echo "════════════════════════════════════════════"
