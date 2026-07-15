# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_all


playwright_datas, playwright_binaries, playwright_hiddenimports = collect_all("playwright")

analysis = Analysis(
    ["main.py"],
    pathex=[],
    binaries=playwright_binaries,
    datas=playwright_datas + [("assets/qlu-toolbox.ico", "assets")],
    hiddenimports=playwright_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter"],
    noarchive=False,
    optimize=1,
)

pyz = PYZ(analysis.pure)

executable = EXE(
    pyz,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="QLUToolbox",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=["assets/qlu-toolbox.ico"],
)

collection = COLLECT(
    executable,
    analysis.binaries,
    analysis.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="QLUToolbox",
)
