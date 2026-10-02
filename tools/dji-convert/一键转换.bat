@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"

echo.
echo ============================================================
echo   大疆视频一键转换工具
echo   把 HEVC 10-bit 视频转成浏览器可直接播放的 H.264 MP4
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有检测到 Node.js
  echo.
  echo 请先安装 Node.js：https://nodejs.org/
  echo 安装后重新双击本文件。
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\@ffmpeg-installer" (
  echo 首次运行，正在准备转换引擎（约 70MB，只需一次）...
  echo.
  call npm install --no-audit --no-fund --registry=https://registry.npmmirror.com
  if errorlevel 1 (
    echo.
    echo [错误] 引擎准备失败。请检查网络后重试。
    echo.
    pause
    exit /b 1
  )
  echo.
)

if not exist "input" mkdir input
if not exist "output" mkdir output

if "%~1"=="" (
  node convert.mjs
) else (
  node convert.mjs %*
)

echo.
echo 按任意键关闭窗口...
pause >nul
endlocal
