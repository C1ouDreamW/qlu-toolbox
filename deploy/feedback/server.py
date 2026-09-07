#!/usr/bin/env python3
"""LumaTile 应用内反馈服务：标准库 HTTP + SQLite。"""

from __future__ import annotations

import json
import os
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque
from contextlib import closing
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DB_PATH = Path(os.environ.get("FEEDBACK_DB_PATH", "/data/feedback.db"))
MAX_BODY_BYTES = 8 * 1024
RATE_LIMIT = 5
RATE_WINDOW_SECONDS = 60 * 60
ALLOWED_TYPES = {"bug", "suggestion"}
ALLOWED_PLATFORMS = {"desktop", "android"}
_requests: dict[str, deque[float]] = defaultdict(deque)
_rate_lock = threading.Lock()


def init_db(path: Path = DB_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path)) as connection, connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS feedback (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                content TEXT NOT NULL,
                contact TEXT NOT NULL DEFAULT '',
                platform TEXT NOT NULL,
                app_version TEXT NOT NULL,
                system_version TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'new',
                created_at TEXT NOT NULL
            )
            """
        )


def validate_feedback(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ValueError("请求内容无效")
    feedback_type = value.get("type")
    content = value.get("content")
    contact = value.get("contact", "")
    platform = value.get("platform")
    app_version = value.get("appVersion")
    system_version = value.get("systemVersion", "")
    website = value.get("website", "")
    if website:
        raise ValueError("请求内容无效")
    if not isinstance(feedback_type, str) or feedback_type not in ALLOWED_TYPES:
        raise ValueError("请选择反馈类型")
    if not isinstance(content, str) or not 2 <= len(content.strip()) <= 2000:
        raise ValueError("反馈内容需为 2～2000 个字符")
    if not isinstance(contact, str) or len(contact.strip()) > 120:
        raise ValueError("联系方式不能超过 120 个字符")
    if not isinstance(platform, str) or platform not in ALLOWED_PLATFORMS:
        raise ValueError("平台信息无效")
    if not isinstance(app_version, str) or not 1 <= len(app_version.strip()) <= 40:
        raise ValueError("应用版本无效")
    if not isinstance(system_version, str) or len(system_version.strip()) > 120:
        raise ValueError("系统版本不能超过 120 个字符")
    return {
        "type": feedback_type,
        "content": content.strip(),
        "contact": contact.strip(),
        "platform": platform,
        "app_version": app_version.strip(),
        "system_version": system_version.strip(),
    }


def save_feedback(value: dict[str, str], path: Path = DB_PATH) -> str:
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with closing(sqlite3.connect(path)) as connection, connection:
        for _ in range(3):
            feedback_id = f"FB-{secrets.token_hex(4).upper()}"
            try:
                connection.execute(
                    "INSERT INTO feedback "
                    "(id, type, content, contact, platform, app_version, system_version, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (feedback_id, value["type"], value["content"], value["contact"],
                     value["platform"], value["app_version"], value["system_version"], created_at),
                )
                return feedback_id
            except sqlite3.IntegrityError:
                continue
    raise RuntimeError("无法生成反馈编号")


def rate_limited(client: str, now: float | None = None) -> bool:
    timestamp = time.monotonic() if now is None else now
    with _rate_lock:
        for key in list(_requests):
            if not _requests[key] or timestamp - _requests[key][-1] >= RATE_WINDOW_SECONDS:
                del _requests[key]
        history = _requests[client]
        while history and timestamp - history[0] >= RATE_WINDOW_SECONDS:
            history.popleft()
        if len(history) >= RATE_LIMIT:
            return True
        history.append(timestamp)
        return False


class FeedbackHandler(BaseHTTPRequestHandler):
    server_version = "LumaTileFeedback/1"

    def _cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")

    def _json(self, status: HTTPStatus, value: dict[str, object]) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self._cors_headers()
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/feedback":
            self._json(HTTPStatus.NOT_FOUND, {"error": "接口不存在"})
            return
        forwarded = self.headers.get("X-Forwarded-For", "").rsplit(",", 1)[-1].strip()
        client = forwarded or self.client_address[0]
        if rate_limited(client):
            self._json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "提交过于频繁，请稍后再试"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "请求大小无效"})
            return
        try:
            payload = json.loads(self.rfile.read(length))
            feedback = validate_feedback(payload)
            feedback_id = save_feedback(feedback)
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._json(HTTPStatus.BAD_REQUEST, {"error": "请求内容无效"})
            return
        except ValueError as error:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        except Exception:
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "暂时无法保存反馈，请稍后再试"})
            return
        self._json(HTTPStatus.CREATED, {"id": feedback_id})

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}")


def main() -> None:
    init_db()
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), FeedbackHandler)
    print(f"LumaTile feedback service listening on :{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
