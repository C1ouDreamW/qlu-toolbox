from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AppPaths:
    config_dir: Path
    data_dir: Path
    log_dir: Path
    profile_dir: Path

    @classmethod
    def discover(cls) -> "AppPaths":
        home = Path.home()
        if sys.platform == "win32":
            config_root = Path(os.environ.get("APPDATA", home / "AppData" / "Roaming"))
            data_root = Path(os.environ.get("LOCALAPPDATA", home / "AppData" / "Local"))
        elif sys.platform == "darwin":
            application_support = home / "Library" / "Application Support"
            config_root = application_support
            data_root = application_support
        else:
            config_root = Path(os.environ.get("XDG_CONFIG_HOME", home / ".config"))
            data_root = Path(os.environ.get("XDG_DATA_HOME", home / ".local" / "share"))
        config_dir = config_root / "QLUToolbox"
        data_dir = data_root / "QLUToolbox"
        return cls(
            config_dir=config_dir,
            data_dir=data_dir,
            log_dir=data_dir / "logs",
            profile_dir=data_dir / "profiles",
        )

    def ensure(self) -> None:
        for path in (self.config_dir, self.data_dir, self.log_dir, self.profile_dir):
            path.mkdir(parents=True, exist_ok=True)


def downloads_dir() -> Path:
    candidate = Path.home() / "Downloads"
    return candidate if candidate.exists() else Path.home()
