#!/usr/bin/env bash
# 文件中转站 —— Linux / macOS 启动脚本
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js。请先安装 Node.js 18.15 或更高版本："
  echo "  Ubuntu/Debian: sudo apt install nodejs npm"
  echo "  Fedora:        sudo dnf install nodejs npm"
  echo "  Arch:          sudo pacman -S nodejs npm"
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
NODE_MINOR=$(node -p "process.versions.node.split('.')[1]")
if [ "$NODE_MAJOR" -lt 18 ] || { [ "$NODE_MAJOR" -eq 18 ] && [ "$NODE_MINOR" -lt 15 ]; }; then
  echo "当前 Node.js 版本为 $(node -v)，本服务需要 18.15 以上（用到 fs.statfs）。"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[首次运行] 正在安装依赖，请稍候…"
  npm install
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "提示：未检测到 ffmpeg，视频封面将不可用。"
  echo "      Ubuntu/Debian 可执行：sudo apt install ffmpeg"
fi

echo "正在启动文件中转站…"
exec npm start
