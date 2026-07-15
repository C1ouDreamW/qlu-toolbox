@echo off
setlocal
cd /d "%~dp0"

where uv >nul 2>nul
if errorlevel 1 (
    echo [ERROR] uv is required. Install it from https://docs.astral.sh/uv/
    pause
    exit /b 1
)

echo Syncing locked build dependencies with uv...
uv sync --locked
if errorlevel 1 goto :failed

echo Building QLU Toolbox Alpha...
uv run --locked pyinstaller --noconfirm QLUToolbox.spec
if errorlevel 1 goto :failed

echo Creating shortcut...
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut((Resolve-Path 'dist\QLUToolbox').Path + '\QLUToolbox.lnk'); $s.TargetPath = (Resolve-Path 'dist\QLUToolbox\QLUToolbox.exe').Path; $s.WorkingDirectory = (Resolve-Path 'dist\QLUToolbox').Path; $s.IconLocation = (Resolve-Path 'assets\qlu-toolbox.ico').Path + ',0'; $s.Save()"
if errorlevel 1 goto :failed

echo.
echo Build completed: dist\QLUToolbox\QLUToolbox.exe
echo Shortcut created: dist\QLUToolbox\QLUToolbox.lnk
pause
exit /b 0

:failed
echo.
echo Build failed. Review uv and PyInstaller output above.
pause
exit /b 1
