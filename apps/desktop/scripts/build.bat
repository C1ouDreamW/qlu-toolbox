@echo off
setlocal
cd /d "%~dp0..\..\.." || exit /b 1

set "UV_CACHE_DIR=%CD%\.uv-cache"
set "npm_config_cache=%CD%\.npm-cache"
if not defined ELECTRON_MIRROR set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
if not defined ELECTRON_BUILDER_BINARIES_MIRROR set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"

where uv >nul 2>nul
if errorlevel 1 (
    echo [ERROR] uv is required. Install it from https://docs.astral.sh/uv/
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js and npm are required.
    pause
    exit /b 1
)

echo [1/3] Syncing Python dependencies...
uv sync --locked
if errorlevel 1 goto :failed

echo [2/3] Installing desktop dependencies...
call npm ci
if errorlevel 1 goto :failed

echo [3/3] Building Vue, Electron and Python worker...
call npm run dist
if errorlevel 1 goto :failed

echo.
echo Build completed successfully.
echo Output directory: release\win-unpacked
pause
exit /b 0

:failed
echo.
echo Build failed. Review the output above.
pause
exit /b 1
