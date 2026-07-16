from __future__ import annotations

import inspect
import json
import os
from pathlib import Path
from typing import Any

from qlu_toolbox.core.paths import AppPaths


DOWNLOAD_SIZE_MIB = 180
INSTALLED_SIZE_MIB = 350


def configure_browser_environment(paths: AppPaths) -> None:
    """Keep the managed browser in QLU Toolbox's own application-data directory."""
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(paths.browser_dir)


def _playwright_browser_metadata() -> tuple[str, str]:
    import playwright

    metadata_path = (
        Path(inspect.getfile(playwright)).parent / "driver" / "package" / "browsers.json"
    )
    payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    chromium = next(item for item in payload["browsers"] if item["name"] == "chromium")
    return str(chromium["revision"]), str(chromium.get("browserVersion", ""))


def expected_browser_executable(paths: AppPaths) -> Path:
    configure_browser_environment(paths)
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        return Path(playwright.chromium.executable_path)


def directory_size(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for child in path.rglob("*"):
        try:
            if child.is_file():
                total += child.stat().st_size
        except OSError:
            continue
    return total


def browser_component_status(paths: AppPaths) -> dict[str, Any]:
    configure_browser_environment(paths)
    revision = ""
    version = ""
    executable: Path | None = None
    status_error = ""
    try:
        revision, version = _playwright_browser_metadata()
        executable = expected_browser_executable(paths)
    except Exception as exc:
        status_error = str(exc).splitlines()[0]

    size_bytes = directory_size(paths.browser_dir)
    installed = executable is not None and executable.is_file()
    return {
        "installed": installed,
        "hasFiles": size_bytes > 0,
        "installing": False,
        "version": version,
        "revision": revision,
        "path": str(paths.browser_dir),
        "executable": str(executable) if executable is not None else "",
        "sizeBytes": size_bytes,
        "downloadSizeMiB": DOWNLOAD_SIZE_MIB,
        "installedSizeMiB": INSTALLED_SIZE_MIB,
        "error": status_error,
    }


def browser_install_command() -> tuple[list[str], dict[str, str]]:
    from playwright._impl._driver import compute_driver_executable, get_driver_env

    node, cli = compute_driver_executable()
    return [node, cli, "install", "--no-shell", "chromium"], get_driver_env()
