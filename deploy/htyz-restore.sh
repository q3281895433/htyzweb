#!/usr/bin/env bash
# ============================================================
#  htyz.space 迁移恢复脚本
#
#  在【新服务器】上运行，从 htyz-backup-for-migration.sh 产出的
#  迁移包恢复完整站点。
#
#  用法：sudo bash htyz-restore.sh <迁移包路径>
#
#  脚本会在关键步骤前确认，不会静默覆盖已有数据。
# ============================================================
set -euo pipefail

ARCHIVE="${1:?用法: bash htyz-restore.sh <迁移包.tar.gz>}"
SITE_DIR=/opt/htyz
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d /tmp/htyz-restore.XXXXXX)"

log() { printf '\033[36m▶\033[0m %s\n' "$*"; }
ok()  { printf '\033[32m✅\033[0m %s\n' "$*"; }
warn(){ printf '\033[33m⚠️\033[0m  %s\n' "$*"; }
die() { printf '\033[31m❌\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行（需要写 /opt、/etc）"
[ -f "$ARCHIVE" ] || die "找不到迁移包：$ARCHIVE"

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# ------------------------------------------------------------
# 1) 解包并校验
# ------------------------------------------------------------
log "解包迁移包"
tar -xzf "$ARCHIVE" -C "$WORK"
PKG="$(find "$WORK" -maxdepth 1 -type d -name 'htyz-migration-*' | head -1)"
[ -n "$PKG" ] || die "迁移包结构不正确"
ok "解包完成：$PKG"

log "校验文件完整性"
if [ -f "$PKG/SHA256SUMS" ]; then
  ( cd "$PKG" && sha256sum -c SHA256SUMS --quiet ) && ok "校验通过" || die "校验失败，迁移包可能损坏"
else
  warn "迁移包内没有 SHA256SUMS，跳过校验"
fi

echo
cat "$PKG/ENVIRONMENT.txt" 2>/dev/null | sed 's/^/  /'
echo

# ------------------------------------------------------------
# 2) 检查目标环境
# ------------------------------------------------------------
log "检查目标服务器环境"
command -v node >/dev/null || die "未安装 Node.js（需要 18.18+）"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js 版本过低（当前 $(node -v)，需要 18.18+）"
ok "Node.js $(node -v)"

MISSING=()
for c in nginx ffmpeg ffprobe; do
  command -v "$c" >/dev/null || MISSING+=("$c")
done
if [ ${#MISSING[@]} -gt 0 ]; then
  warn "缺少：${MISSING[*]}"
  echo "  视频自动转码依赖 ffmpeg/ffprobe；nginx 用于反向代理。"
  echo "  Debian/Ubuntu 可执行：apt-get install -y nginx ffmpeg"
  read -r -p "  仍要继续吗？(y/N) " ans
  [ "$ans" = "y" ] || exit 1
fi

if [ -e "$SITE_DIR/data/htyz.db" ]; then
  warn "$SITE_DIR/data/htyz.db 已存在"
  read -r -p "  这会覆盖现有数据库！确认继续？(输入 yes 继续) " ans
  [ "$ans" = "yes" ] || die "已取消"
  cp -a "$SITE_DIR/data" "/root/htyz-data-backup-$STAMP"
  ok "已备份原数据到 /root/htyz-data-backup-$STAMP"
fi

# ------------------------------------------------------------
# 3) 恢复文件
# ------------------------------------------------------------
log "创建目录与专用用户"
if ! id htyz >/dev/null 2>&1; then
  useradd --system --home-dir "$SITE_DIR" --shell /usr/sbin/nologin htyz
  ok "已创建系统用户 htyz"
else
  ok "用户 htyz 已存在"
fi

mkdir -p "$SITE_DIR/data" "$SITE_DIR/uploads" "$SITE_DIR/logs"

log "恢复数据库"
install -m 640 -o htyz -g htyz "$PKG/data/htyz.db" "$SITE_DIR/data/htyz.db"
ok "数据库已恢复（$(du -h "$SITE_DIR/data/htyz.db" | cut -f1)）"

log "恢复上传文件"
rm -rf "$SITE_DIR/uploads"
tar -xzf "$PKG/uploads.tar.gz" -C "$SITE_DIR"
chown -R htyz:htyz "$SITE_DIR/uploads"
chmod 750 "$SITE_DIR/uploads"
find "$SITE_DIR/uploads" -type f -exec chmod 640 {} \;
ok "上传文件已恢复（$(find "$SITE_DIR/uploads" -type f | wc -l) 个）"

log "恢复应用代码"
if [ -d "$SITE_DIR/server" ]; then
  cp -a "$SITE_DIR/server" "/root/htyz-server-backup-$STAMP" 2>/dev/null || true
fi
tar -xzf "$PKG/app.tar.gz" -C "$SITE_DIR"
find "$SITE_DIR/server" "$SITE_DIR/dist" -type d -exec chmod 755 {} \;
find "$SITE_DIR/server" "$SITE_DIR/dist" -type f -exec chmod 644 {} \;
chown -R root:htyz "$SITE_DIR/server" "$SITE_DIR/dist"
chmod 644 "$SITE_DIR/package.json" "$SITE_DIR/package-lock.json" 2>/dev/null || true
ok "应用代码已恢复"

log "恢复环境配置"
if [ -f "$SITE_DIR/.env" ]; then
  cp -a "$SITE_DIR/.env" "/root/htyz-env-backup-$STAMP"
  warn "原 .env 已备份到 /root/htyz-env-backup-$STAMP"
fi
install -m 640 -o root -g htyz "$PKG/system/env.backup" "$SITE_DIR/.env"
ok ".env 已恢复（含 SMTP 授权码，权限 640）"

# ------------------------------------------------------------
# 4) 安装依赖
# ------------------------------------------------------------
log "安装 Node 依赖（编译 better-sqlite3，可能需要几分钟）"
cd "$SITE_DIR"
if ! command -v gcc >/dev/null 2>&1; then
  warn "未检测到编译工具链，better-sqlite3 可能安装失败"
  echo "  Debian/Ubuntu：apt-get install -y build-essential python3"
fi
npm install --omit=dev --no-audit --no-fund 2>&1 | tail -5
ok "依赖安装完成"

# ------------------------------------------------------------
# 5) 系统配置
# ------------------------------------------------------------
log "安装 systemd 服务"
install -m 644 "$PKG/system/htyz.service" /etc/systemd/system/htyz.service
systemctl daemon-reload
systemctl enable htyz >/dev/null 2>&1 || true
ok "systemd 服务已安装"

if [ -f "$PKG/system/nginx-htyz.conf" ]; then
  log "安装 nginx 配置"
  install -m 644 "$PKG/system/nginx-htyz.conf" /etc/nginx/sites-available/htyz
  ln -sfn /etc/nginx/sites-available/htyz /etc/nginx/sites-enabled/htyz
  # 移除发行版默认站点，避免抢占 80 端口
  [ -e /etc/nginx/sites-enabled/default ] && rm -f /etc/nginx/sites-enabled/default && warn "已移除 nginx 默认站点"
  nginx -t || die "nginx 配置有误，请检查"
  ok "nginx 配置已安装并通过检查"
fi

if [ -f "$PKG/system/99-htyz-network.conf" ]; then
  install -m 644 "$PKG/system/99-htyz-network.conf" /etc/sysctl.d/99-htyz-network.conf
  sysctl -p /etc/sysctl.d/99-htyz-network.conf >/dev/null 2>&1 || true
  ok "网络调优参数已安装"
fi

# ------------------------------------------------------------
# 6) 启动并验证
# ------------------------------------------------------------
log "启动服务"
systemctl restart htyz
sleep 4
systemctl is-active htyz >/dev/null || {
  echo "--- 服务启动失败，最近日志 ---"
  journalctl -u htyz --no-pager -n 30
  die "服务启动失败"
}
ok "htyz 服务已启动"

log "本机健康检查"
HEALTH="$(curl -s -m 10 http://127.0.0.1:3000/api/health || true)"
echo "  $HEALTH"
echo "$HEALTH" | grep -q '"ok":true' || warn "健康检查未返回 ok，请查看日志"

if command -v nginx >/dev/null; then
  systemctl reload nginx 2>/dev/null || systemctl restart nginx 2>/dev/null || true
  systemctl is-active nginx >/dev/null && ok "nginx 运行中"
fi

# ------------------------------------------------------------
# 7) 后续指引
# ------------------------------------------------------------
cat <<'GUIDE'

════════════════════════════════════════════
 迁移完成，接下来必须做这几件事
════════════════════════════════════════════

1) HTTPS 证书
   新服务器需要重新签发（旧证书与旧 IP 无关，但用 certbot 重签最简单）：
     apt-get install -y certbot python3-certbot-nginx
     certbot --nginx -d htyz.space -d www.htyz.space --agree-tos -m 你的邮箱

   注意：Debian 的 nginx 未编译 IPv6 支持，若 certbot 注入了
   listen [::]:443 会导致 nginx 起不来，需要删除该行：
     sed -i '/listen \[::\]/d' /etc/nginx/sites-available/htyz

2) 域名解析
   把 htyz.space 的 A 记录改到新服务器 IP。
   ⚠️ 国内服务器必须等 ICP 备案通过后才能对外提供网站服务。

3) 视频转码
   确认 ffmpeg 可用，并检查服务日志出现：
     [video] 自动转码已启动

4) 验收清单
   □ curl -I https://htyz.space/            应返回 200
   □ 上传一个视频，确认自动转码并生成封面
   □ 管理员入口 /admin 能打开、校园新闻列表正常
   □ 老用户能用原密码登录（数据库已迁移）

5) 回退
   旧服务器保持运行即可随时回退，只需把 DNS 改回去。
   恢复前的原数据备份在 /root/htyz-data-backup-*
════════════════════════════════════════════
GUIDE
