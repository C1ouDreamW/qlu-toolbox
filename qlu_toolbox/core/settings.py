from __future__ import annotations

import json
from dataclasses import asdict, dataclass, fields
from pathlib import Path

from .paths import AppPaths, downloads_dir


@dataclass
class AppSettings:
    schema_version: int = 1
    welcome_accepted: bool = False
    default_output_dir: str = ""
    preferred_browser: str = "auto"
    keep_login_state: bool = True
    theme: str = "light"
    check_updates: bool = True
    anonymous_stats: bool = True

    def normalized(self) -> "AppSettings":
        if not self.default_output_dir:
            self.default_output_dir = str(downloads_dir())
        if self.preferred_browser not in {"auto", "edge", "chrome", "chromium"}:
            self.preferred_browser = "auto"
        if self.theme not in {"light", "dark", "system"}:
            self.theme = "light"
        return self


class SettingsStore:
    def __init__(self, paths: AppPaths) -> None:
        self.path = paths.config_dir / "settings.json"

    def load(self) -> AppSettings:
        if not self.path.exists():
            return AppSettings().normalized()
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            allowed = {field.name for field in fields(AppSettings)}
            values = {key: value for key, value in raw.items() if key in allowed}
            return AppSettings(**values).normalized()
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            self._backup_broken_file()
            return AppSettings().normalized()

    def save(self, settings: AppSettings) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(asdict(settings.normalized()), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary.replace(self.path)

    def _backup_broken_file(self) -> None:
        try:
            backup = self.path.with_suffix(".json.broken")
            if backup.exists():
                backup.unlink()
            self.path.replace(backup)
        except OSError:
            pass
