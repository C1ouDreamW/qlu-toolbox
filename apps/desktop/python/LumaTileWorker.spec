# -*- mode: python ; coding: utf-8 -*-

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all

python_dir = Path(SPECPATH).resolve()
repository = python_dir.parents[2]
playwright_datas, playwright_binaries, playwright_hiddenimports = collect_all("playwright")
worker_icon = python_dir.parent / "assets" / ("lumatile.icns" if sys.platform == "darwin" else "lumatile.ico")

analysis = Analysis(
    [str(python_dir / "main.py")],
    pathex=[],
    binaries=playwright_binaries,
    datas=playwright_datas + [
        (str(repository / "packages/school-web/qlu-schedule-dom.js"), "assets"),
        (str(python_dir / "lumatile/build-info.json"), "lumatile"),
    ],
    hiddenimports=playwright_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "PySide6"],
    noarchive=False,
    optimize=1,
)

pyz = PYZ(analysis.pure)

executable = EXE(
    pyz,
    analysis.scripts,
    analysis.binaries,
    analysis.datas,
    [],
    name="LumaTileWorker",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    icon=[str(worker_icon)],
)
