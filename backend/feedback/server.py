#!/usr/bin/env python3
"""LumaTile 应用内反馈服务：标准库 HTTP + SQLite。

公开接口只有 POST /api/feedback。/admin/* 为管理端（管理页、列表、标记状态），
只应通过更新源 Nginx 的 /admin/ 路由暴露：Nginx 层做 Basic Auth（与统计页共用
凭据文件），鉴权成功后注入 X-Admin-User 头；服务端校验该头，防止绕过 Nginx
直接访问容器端口。FEEDBACK_DEV_ADMIN=1 仅用于本地预览，生产不要开启。
"""

from __future__ import annotations

import json
import os
import re
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
from urllib.parse import parse_qs, urlsplit

DB_PATH = Path(os.environ.get("FEEDBACK_DB_PATH", "/data/feedback.db"))
MAX_BODY_BYTES = 8 * 1024
RATE_LIMIT = 5
RATE_WINDOW_SECONDS = 60 * 60
ALLOWED_TYPES = {"bug", "suggestion"}
ALLOWED_PLATFORMS = {"desktop", "android"}
ADMIN_STATUSES = ("new", "resolved")
FEEDBACK_ID_RE = re.compile(r"^FB-[0-9A-F]{8}$")
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


def escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def list_feedback(
    status: str = "all",
    feedback_type: str = "",
    platform: str = "",
    query: str = "",
    limit: int = 50,
    offset: int = 0,
    path: Path = DB_PATH,
) -> dict[str, object]:
    """按条件列出反馈，返回 items / total / counts，供管理页使用。"""
    clauses: list[str] = []
    params: list[object] = []
    if status in ADMIN_STATUSES:
        clauses.append("status = ?")
        params.append(status)
    if feedback_type in ALLOWED_TYPES:
        clauses.append("type = ?")
        params.append(feedback_type)
    if platform in ALLOWED_PLATFORMS:
        clauses.append("platform = ?")
        params.append(platform)
    if query:
        pattern = f"%{escape_like(query[:120])}%"
        clauses.append("(content LIKE ? ESCAPE '\\' OR contact LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')")
        params.extend([pattern, pattern, pattern])
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    limit = max(1, min(int(limit), 200))
    offset = max(0, int(offset))
    with closing(sqlite3.connect(path)) as connection:
        total = connection.execute(f"SELECT COUNT(*) FROM feedback{where}", params).fetchone()[0]
        rows = connection.execute(
            "SELECT id, type, content, contact, platform, app_version, system_version, status, created_at "
            f"FROM feedback{where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
        counts = {"new": 0, "resolved": 0}
        for row in connection.execute("SELECT status, COUNT(*) FROM feedback GROUP BY status"):
            if row[0] in counts:
                counts[row[0]] = row[1]
    keys = ("id", "type", "content", "contact", "platform", "app_version", "system_version", "status", "created_at")
    return {
        "total": total,
        "items": [dict(zip(keys, row)) for row in rows],
        "counts": counts,
    }


def update_feedback_status(feedback_id: str, status: str, path: Path = DB_PATH) -> bool:
    """更新反馈状态；参数非法抛 ValueError，编号不存在返回 False。"""
    if not isinstance(feedback_id, str) or not FEEDBACK_ID_RE.fullmatch(feedback_id):
        raise ValueError("反馈编号无效")
    if status not in ADMIN_STATUSES:
        raise ValueError("状态取值无效")
    with closing(sqlite3.connect(path)) as connection, connection:
        cursor = connection.execute(
            "UPDATE feedback SET status = ? WHERE id = ?", (status, feedback_id)
        )
    return cursor.rowcount == 1


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


ADMIN_PAGE = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>LumaTile 反馈管理</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; background: #f4f7fb; color: #1c2430; }
  main { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 20px; margin: 0; }
  a { color: #4f6ef7; text-decoration: none; }
  .top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 16px 0; }
  .stat { background: #fff; border-radius: 10px; padding: 14px 16px; }
  .stat-num { font-size: 24px; font-weight: 700; }
  .stat-label { font-size: 12px; color: #667; margin-top: 2px; }
  .card { background: #fff; border-radius: 10px; padding: 14px 16px; margin: 12px 0; }
  .filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  select, input[type="search"] { font: inherit; font-size: 13px; padding: 6px 8px; border: 1px solid #d5dbe5; border-radius: 8px; background: #fff; color: inherit; }
  input[type="search"] { flex: 1; min-width: 150px; }
  button { font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 8px; border: 1px solid #4f6ef7; background: #4f6ef7; color: #fff; cursor: pointer; }
  button.ghost { background: #fff; color: #4f6ef7; }
  button:disabled { opacity: .5; cursor: default; }
  .item .head { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 12px; color: #667; }
  .item .id { font-weight: 700; color: #1c2430; font-family: ui-monospace, Consolas, monospace; }
  .badge { padding: 2px 8px; border-radius: 999px; font-size: 11px; }
  .bug { background: #fdeceb; color: #b3261e; }
  .suggestion { background: #e8f0fe; color: #1a56db; }
  .desktop { background: #eef1f8; color: #4a5878; }
  .android { background: #e6f4ea; color: #137333; }
  .status-new { background: #fff4e5; color: #9a6700; }
  .status-resolved { background: #e6f4ea; color: #137333; }
  .content { white-space: pre-wrap; word-break: break-word; margin: 8px 0 6px; font-size: 14px; line-height: 1.6; }
  .foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; color: #667; }
  .more { text-align: center; margin: 16px 0; }
  .error { color: #b3261e; font-size: 13px; margin-top: 8px; }
  .empty { color: #667; font-size: 13px; text-align: center; padding: 24px 0; }
  .muted { color: #667; font-size: 12px; }
  label.chk { font-size: 12px; color: #667; display: inline-flex; gap: 4px; align-items: center; }
</style></head><body><main>
<div class="top">
  <h1>LumaTile 反馈管理</h1>
  <a href="/stats/">&#8592; 更新源统计</a>
</div>
<div class="cards">
  <div class="stat"><div class="stat-num" id="count-new">&#8211;</div><div class="stat-label">未处理</div></div>
  <div class="stat"><div class="stat-num" id="count-resolved">&#8211;</div><div class="stat-label">已处理</div></div>
</div>
<div class="card">
  <div class="filters">
    <select id="f-status">
      <option value="new" selected>未处理</option>
      <option value="resolved">已处理</option>
      <option value="all">全部</option>
    </select>
    <select id="f-type">
      <option value="">全部类型</option>
      <option value="bug">问题</option>
      <option value="suggestion">建议</option>
    </select>
    <select id="f-platform">
      <option value="">全部平台</option>
      <option value="desktop">桌面端</option>
      <option value="android">Android</option>
    </select>
    <input type="search" id="f-q" placeholder="搜索内容 / 联系方式 / 编号，回车确认">
    <button id="b-refresh">刷新</button>
    <label class="chk"><input type="checkbox" id="f-auto">30 秒自动刷新</label>
  </div>
  <div class="error" id="error" hidden></div>
</div>
<div id="list"></div>
<div class="more"><button id="b-more" class="ghost" hidden></button></div>
<p class="muted">反馈内容仅存储于自建服务器，用于问题排查；处理完成后可标记为已处理。</p>
</main>
<script>
(function () {
  "use strict";
  var state = { status: "new", type: "", platform: "", q: "", offset: 0, total: 0,
                items: [], counts: { new: 0, resolved: 0 }, timer: null, busy: false };
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function badge(cls, text) { return el("span", "badge " + cls, text); }
  function showError(message) { var box = $("error"); box.textContent = message || ""; box.hidden = !message; }
  function fmtTime(iso) {
    var d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString("zh-CN", { hour12: false });
  }
  async function api(url, options) {
    var response = await fetch(url, options || {});
    if (!response.ok) {
      var message = "请求失败（HTTP " + response.status + "）";
      if (response.status === 403) message = "无权访问：本页需经 Nginx 管理入口（Basic Auth）访问";
      try {
        var data = await response.json();
        if (data && data.error) message = data.error;
      } catch (e) { /* 非 JSON 响应，保留默认提示 */ }
      throw new Error(message);
    }
    return response.json();
  }
  function renderCounts() {
    $("count-new").textContent = state.counts.new;
    $("count-resolved").textContent = state.counts.resolved;
  }
  function renderItem(item) {
    var card = el("div", "card item");
    var head = el("div", "head");
    head.appendChild(el("span", "id", item.id));
    head.appendChild(badge(item.type, item.type === "bug" ? "问题" : "建议"));
    head.appendChild(badge(item.platform, item.platform === "desktop" ? "桌面端" : "Android"));
    head.appendChild(badge(item.status === "new" ? "status-new" : "status-resolved",
                           item.status === "new" ? "未处理" : "已处理"));
    var time = el("span", null, fmtTime(item.created_at));
    time.title = item.created_at + "（UTC）";
    head.appendChild(time);
    card.appendChild(head);
    card.appendChild(el("div", "content", item.content));
    var foot = el("div", "foot");
    foot.appendChild(el("span", null,
      "应用 " + item.app_version
      + (item.system_version ? " · 系统 " + item.system_version : "")
      + (item.contact ? " · 联系方式 " + item.contact : "")));
    var action = el("button", item.status === "new" ? "" : "ghost",
                    item.status === "new" ? "标记已处理" : "重新打开");
    action.addEventListener("click", function () { toggleStatus(item, action); });
    foot.appendChild(action);
    card.appendChild(foot);
    return card;
  }
  function renderList() {
    var list = $("list");
    list.textContent = "";
    if (!state.items.length) {
      list.appendChild(el("div", "empty", state.status === "new" ? "没有未处理的反馈" : "暂无反馈"));
    }
    state.items.forEach(function (item) { list.appendChild(renderItem(item)); });
    var remaining = state.total - state.items.length;
    var more = $("b-more");
    more.hidden = remaining <= 0;
    if (remaining > 0) more.textContent = "加载更多（还有 " + remaining + " 条）";
  }
  async function load(reset) {
    if (state.busy) return;
    state.busy = true;
    try {
      var params = new URLSearchParams();
      params.set("status", state.status);
      if (state.type) params.set("type", state.type);
      if (state.platform) params.set("platform", state.platform);
      if (state.q) params.set("q", state.q);
      params.set("limit", "50");
      params.set("offset", String(reset ? 0 : state.offset));
      var data = await api("/admin/api/feedback?" + params.toString());
      state.items = reset ? data.items : state.items.concat(data.items);
      state.offset = reset ? data.items.length : state.offset + data.items.length;
      state.total = data.total;
      state.counts = data.counts;
      renderCounts();
      renderList();
      showError("");
    } catch (error) {
      showError(error.message);
    } finally {
      state.busy = false;
    }
  }
  async function toggleStatus(item, button) {
    button.disabled = true;
    var next = item.status === "new" ? "resolved" : "new";
    try {
      await api("/admin/api/feedback/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, status: next })
      });
      state.counts[item.status] -= 1;
      state.counts[next] += 1;
      item.status = next;
      renderCounts();
      renderList();
      showError("");
    } catch (error) {
      showError(error.message);
      button.disabled = false;
    }
  }
  $("b-refresh").addEventListener("click", function () { load(true); });
  $("b-more").addEventListener("click", function () { load(false); });
  $("f-status").addEventListener("change", function () { state.status = $("f-status").value; load(true); });
  $("f-type").addEventListener("change", function () { state.type = $("f-type").value; load(true); });
  $("f-platform").addEventListener("change", function () { state.platform = $("f-platform").value; load(true); });
  $("f-q").addEventListener("keydown", function (event) {
    if (event.key === "Enter") { state.q = $("f-q").value.trim(); load(true); }
  });
  $("f-auto").addEventListener("change", function () {
    if ($("f-auto").checked) {
      state.timer = setInterval(function () { load(true); }, 30000);
    } else {
      clearInterval(state.timer);
      state.timer = null;
    }
  });
  load(true);
})();
</script></body></html>
"""


class FeedbackHandler(BaseHTTPRequestHandler):
    server_version = "LumaTileFeedback/1"

    def _cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")

    def _no_store_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")

    def _json(self, status: HTTPStatus, value: dict[str, object], cors: bool = True) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._no_store_headers()
        if cors:
            self._cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _html(self, page: str) -> None:
        body = page.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self._no_store_headers()
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _admin_gate(self) -> bool:
        """要求经 Nginx Basic Auth 后注入的 X-Admin-User 头；开发模式放行本地预览。"""
        if os.environ.get("FEEDBACK_DEV_ADMIN") == "1":
            return True
        if self.headers.get("X-Admin-User", "").strip():
            return True
        self._json(HTTPStatus.FORBIDDEN, {"error": "无权访问：管理入口需经 Nginx Basic Auth"}, cors=False)
        return False

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self._cors_headers()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlsplit(self.path).path
        if path in ("/admin", "/admin/"):
            if not self._admin_gate():
                return
            self._html(ADMIN_PAGE)
            return
        if path == "/admin/api/feedback":
            if not self._admin_gate():
                return
            params = parse_qs(urlsplit(self.path).query)
            try:
                result = list_feedback(
                    status=params.get("status", ["all"])[0],
                    feedback_type=params.get("type", [""])[0],
                    platform=params.get("platform", [""])[0],
                    query=params.get("q", [""])[0],
                    limit=params.get("limit", ["50"])[0],
                    offset=params.get("offset", ["0"])[0],
                    path=DB_PATH,
                )
            except ValueError:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "查询参数无效"}, cors=False)
                return
            self._json(HTTPStatus.OK, result, cors=False)
            return
        self._json(HTTPStatus.NOT_FOUND, {"error": "接口不存在"}, cors=False)

    def _read_json_body(self) -> object | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            return None
        try:
            return json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None

    def do_POST(self) -> None:  # noqa: N802
        path = urlsplit(self.path).path
        if path == "/api/feedback":
            self._submit_feedback()
            return
        if path == "/admin/api/feedback/status":
            if not self._admin_gate():
                return
            payload = self._read_json_body()
            if not isinstance(payload, dict):
                self._json(HTTPStatus.BAD_REQUEST, {"error": "请求内容无效"}, cors=False)
                return
            try:
                updated = update_feedback_status(payload.get("id"), payload.get("status"), DB_PATH)
            except ValueError as error:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)}, cors=False)
                return
            if not updated:
                self._json(HTTPStatus.NOT_FOUND, {"error": "反馈不存在"}, cors=False)
                return
            self._json(HTTPStatus.OK, {
                "ok": True,
                "id": payload.get("id"),
                "status": payload.get("status"),
            }, cors=False)
            return
        self._json(HTTPStatus.NOT_FOUND, {"error": "接口不存在"}, cors=False)

    def _submit_feedback(self) -> None:
        forwarded = self.headers.get("X-Forwarded-For", "").rsplit(",", 1)[-1].strip()
        client = forwarded or self.client_address[0]
        if rate_limited(client):
            self._json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "提交过于频繁，请稍后再试"})
            return
        payload = self._read_json_body()
        if payload is None:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "请求大小或内容无效"})
            return
        try:
            feedback = validate_feedback(payload)
            feedback_id = save_feedback(feedback, DB_PATH)
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
    init_db(DB_PATH)
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), FeedbackHandler)
    print(f"LumaTile feedback service listening on :{port}")
    if os.environ.get("FEEDBACK_DEV_ADMIN") == "1":
        print("[warn] FEEDBACK_DEV_ADMIN=1：管理端鉴权已关闭，仅供本地预览，生产环境禁止使用")
    server.serve_forever()


if __name__ == "__main__":
    main()
