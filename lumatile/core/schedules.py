from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .paths import AppPaths

MAX_PAYLOAD_BYTES = 2 * 1024 * 1024
MAX_NAME_LENGTH = 120
SCHEMA_VERSION = 1


class ScheduleValidationError(ValueError):
    pass


def validate_payload(payload: str) -> None:
    if len(payload.encode("utf-8")) > MAX_PAYLOAD_BYTES:
        raise ScheduleValidationError("课表内容超过 2 MB 限制")
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ScheduleValidationError("课表内容不是有效的 JSON") from exc
    if (
        not isinstance(parsed, dict)
        or parsed.get("schemaVersion") != SCHEMA_VERSION
        or not isinstance(parsed.get("courses"), list)
    ):
        raise ScheduleValidationError("课表格式不受支持")


def validate_name(name: str) -> str:
    value = name.strip()
    if not value:
        raise ScheduleValidationError("课表名称不能为空")
    return value[:MAX_NAME_LENGTH]


def validate_schedule_id(schedule_id: str) -> str:
    value = schedule_id.strip()
    if not value:
        raise ScheduleValidationError("课表编号不能为空")
    return value


class ScheduleStore:
    """存储多份课表；payload 是整份 ScheduleBook JSON 的不透明字符串，格式由渲染层负责。"""

    def __init__(self, paths: AppPaths) -> None:
        self.path = paths.data_dir / "schedules.json"

    def list_schedules(self) -> list[dict[str, object]]:
        if not self.path.exists():
            return []
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            schedules = raw.get("schedules") if isinstance(raw, dict) else None
            if not isinstance(schedules, list):
                raise ValueError("课表存储结构无效")
            rows = [self._valid_row(item) for item in schedules]
        except (OSError, ValueError, json.JSONDecodeError):
            self._backup_broken_file()
            return []
        active = [row for row in rows if row["isActive"]]
        inactive = [row for row in rows if not row["isActive"]]
        active.sort(key=lambda row: str(row["updatedAt"]), reverse=True)
        inactive.sort(key=lambda row: str(row["updatedAt"]), reverse=True)
        return active + inactive

    def save(self, schedule_id: str, name: str, payload: str, make_active: bool) -> dict[str, object]:
        schedule_id = validate_schedule_id(schedule_id)
        name = validate_name(name)
        validate_payload(payload)
        rows = [row for row in self.list_schedules() if row["id"] != schedule_id]
        if make_active:
            for row in rows:
                row["isActive"] = False
        row = {
            "id": schedule_id,
            "name": name,
            "payload": payload,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "isActive": make_active or not rows,
        }
        rows.append(row)
        self._write(rows)
        return row

    def activate(self, schedule_id: str) -> bool:
        schedule_id = validate_schedule_id(schedule_id)
        rows = self.list_schedules()
        if not any(row["id"] == schedule_id for row in rows):
            raise ScheduleValidationError("课表不存在")
        for row in rows:
            row["isActive"] = row["id"] == schedule_id
        self._write(rows)
        return True

    def delete(self, schedule_id: str) -> bool:
        schedule_id = validate_schedule_id(schedule_id)
        rows = self.list_schedules()
        remaining = [row for row in rows if row["id"] != schedule_id]
        if len(remaining) == len(rows):
            raise ScheduleValidationError("课表不存在")
        if remaining and not any(row["isActive"] for row in remaining):
            remaining[0]["isActive"] = True
        self._write(remaining)
        return True

    @staticmethod
    def _valid_row(item: object) -> dict[str, object]:
        if not isinstance(item, dict):
            raise ValueError("课表条目无效")
        row: dict[str, object] = {
            "id": str(item.get("id", "")),
            "name": str(item.get("name", "")),
            "payload": str(item.get("payload", "")),
            "updatedAt": str(item.get("updatedAt", "")),
            "isActive": bool(item.get("isActive", False)),
        }
        if not row["id"]:
            raise ValueError("课表编号缺失")
        return row

    def _write(self, rows: list[dict[str, object]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps({"schemaVersion": SCHEMA_VERSION, "schedules": rows}, ensure_ascii=False, indent=2),
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
