#!/bin/bash
# 大疆视频一键转换工具 —— macOS 入口
# 双击本文件即可运行。若提示「无法打开」，请右键 →「打开」。

cd "$(dirname "$0")" || exit 1

echo ""
echo "============================================================"
echo "  大疆视频一键转换工具"
echo "  把 HEVC 10-bit 视频转成浏览器可直接播放的 H.264 MP4"
echo "============================================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 没有检测到 Node.js"
  echo ""
  echo "请先安装 Node.js：https://nodejs.org/"
  echo "安装后重新双击本文件。"
  echo ""
  read -r -p "按回车键关闭…" _
  exit 1
fi

if [ ! -d "node_modules/@ffmpeg-installer" ]; then
  echo "首次运行，正在准备转换引擎（约 70MB，只需一次）..."
  echo ""
  if ! npm install --no-audit --no-fund --registry=https://registry.npmmirror.com; then
    echo ""
    echo "[错误] 引擎准备失败。请检查网络后重试。"
    echo ""
    read -r -p "按回车键关闭…" _
    exit 1
  fi
  echo ""
fi

mkdir -p input output

node convert.mjs "$@"

echo ""
read -r -p "按回车键关闭…" _
