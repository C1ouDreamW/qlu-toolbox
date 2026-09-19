# -*- mode: python ; coding: utf-8 -*-

import sys

from PyInstaller.utils.hooks import collect_all

playwright_datas, playwright_binaries, playwright_hiddenimports = collect_all("playwright")
worker_icon = "assets/qlu-toolbox.icns" if sys.platform == "darwin" else "assets/qlu-toolbox.ico"

analysis = Analysis(
    ["main.py"],
    pathex=[],
    binaries=playwright_binaries,
    datas=playwright_datas + [("assets/qlu-schedule-dom.js", "assets")],
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
    name="QLUToolboxWorker",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    icon=[worker_icon],
)
