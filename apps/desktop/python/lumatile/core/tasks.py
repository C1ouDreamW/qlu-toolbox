from __future__ import annotations

import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterator


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


@dataclass(frozen=True)
class TaskRecord:
    id: str
    tool_id: str
    tool_name: str
    tool_version: str
    status: str
    summary: str
    result_path: str
    error_message: str
    created_at: str
    started_at: str
    finished_at: str


class TaskStore:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()
        self.mark_interrupted()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    tool_id TEXT NOT NULL,
                    tool_name TEXT NOT NULL,
                    tool_version TEXT NOT NULL,
                    status TEXT NOT NULL,
                    summary TEXT NOT NULL DEFAULT '',
                    result_path TEXT NOT NULL DEFAULT '',
                    error_message TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    started_at TEXT NOT NULL DEFAULT '',
                    finished_at TEXT NOT NULL DEFAULT ''
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC)"
            )

    def create(self, tool_id: str, tool_name: str, tool_version: str, summary: str) -> str:
        task_id = str(uuid.uuid4())
        now = _now()
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO tasks (
                    id, tool_id, tool_name, tool_version, status, summary, created_at, started_at
                ) VALUES (?, ?, ?, ?, 'running', ?, ?, ?)
                """,
                (task_id, tool_id, tool_name, tool_version, summary, now, now),
            )
        return task_id

    def complete(self, task_id: str, result_path: str) -> None:
        self._finish(task_id, "success", result_path=result_path)

    def fail(self, task_id: str, message: str) -> None:
        self._finish(task_id, "failed", error_message=message)

    def cancel(self, task_id: str) -> None:
        self._finish(task_id, "cancelled")

    def _finish(
        self,
        task_id: str,
        status: str,
        *,
        result_path: str = "",
        error_message: str = "",
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE tasks
                SET status = ?, result_path = ?, error_message = ?, finished_at = ?
                WHERE id = ?
                """,
                (status, result_path, error_message, _now(), task_id),
            )

    def mark_interrupted(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE tasks
                SET status = 'interrupted',
                    error_message = '上次运行异常中断',
                    finished_at = ?
                WHERE status = 'running'
                """,
                (_now(),),
            )

    def list_recent(self, limit: int = 50) -> list[TaskRecord]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [TaskRecord(**dict(row)) for row in rows]

    def clear(self) -> None:
        with self._connect() as connection:
            connection.execute("DELETE FROM tasks WHERE status != 'running'")
