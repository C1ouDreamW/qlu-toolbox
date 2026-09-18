#!/usr/bin/env python3
"""LumaTile 更新源访问统计。

增量解析宿主机 nginx 访问日志（水位按 (路径, inode, 偏移) 记录），把匿名统计
心跳（/beacon/*）与安装包下载（/releases/*）落到 SQLite，再尽力拉取 GitHub
Releases 下载计数，最后生成自包含的 stats.html / stats.json 报告。

只用 Python 标准库，设计为 /etc/cron.d 每日执行一次。
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sqlite3
import sys
import urllib.request
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

DEFAULT_CONFIG = Path("/opt/lumatile-stats/config.json")

LOG_LINE_RE = re.compile(
    r'^(?P<addr>\S+) \S+ \S+ \[(?P<time>[^\]]+)\] '
    r'"(?P<request>(?P<method>[A-Z]+) (?P<target>\S+) [^"]*)" '
    r'(?P<status>\d{3}) (?P<bytes>\S+)'
)

MONTHS = {
    "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
    "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
}


def parse_log_time(raw: str) -> tuple[str, str] | None:
    """nginx $time_local，如 05/Sep/2026:13:24:01 +0800 → (服务器本地日 'YYYY-MM-DD', ISO 时刻)。

    只取服务器本地时间（nginx 日志默认就是本地时间），偏移量忽略——按天聚合不受影响。
    """
    try:
        date_part = raw.split(" ", 1)[0]
        date, clock = date_part.split(":", 1)
        day, month_name, year = date.split("/")
        month = MONTHS.get(month_name)
        if month is None:
            return None
        hour, minute, second = (int(part) for part in clock.split(":"))
        datetime(int(year), month, int(day), hour, minute, second)  # 校验日期合法
        stamp = f"{int(year):04d}-{month:02d}-{int(day):02d}"
        return stamp, f"{stamp}T{clock}"
    except (ValueError, IndexError):
        return None


def parse_log_line(line: str) -> dict | None:
    """解析一行 combined 日志；只关心 beacon 与 releases 两类 2xx/3xx 请求。"""
    match = LOG_LINE_RE.match(line)
    if not match:
        return None
    status = int(match.group("status"))
    if match.group("method") != "GET" or status not in {200, 204, 206, 304}:
        return None
    when = parse_log_time(match.group("time"))
    if when is None:
        return None
    day, ts = when
    target = match.group("target")
    split = urlsplit(target)
    path, query = split.path, parse_qs(split.query)

    if path == "/beacon/desktop" or path == "/beacon/android":
        client = "desktop" if path.endswith("desktop") else "android"
        return {
            "kind": "beacon", "day": day, "ts": ts, "client": client,
            "version": query.get("v", [""])[0] or None,
            "os": query.get("os", [""])[0] or None,
            "arch": query.get("arch", [""])[0] or None,
            "install_id": query.get("id", [""])[0] or None,
        }
    if path == "/stable/desktop.json" or path == "/stable/android.json":
        # 旧版客户端只发这种无参数请求，单独计数以便对比
        client = "desktop" if path.endswith("desktop.json") else "android"
        return {"kind": "manifest", "day": day, "ts": ts, "client": client}
    if path.startswith("/releases/"):
        if status not in {200, 206} or not path.lower().endswith((".apk", ".exe", ".dmg", ".zip")):
            return None
        rest = path[len("/releases/"):].strip("/")
        if not rest:
            return None
        parts = rest.split("/")
        tag = parts[0] if len(parts) > 1 else ""
        return {"kind": "download", "day": day, "ts": ts, "tag": tag, "filename": parts[-1]}
    return None


def iter_log_lines(path: str, start: int) -> tuple[list[str], int]:
    """从 start 偏移读取纯文本日志，返回 (完整行列表, 新偏移)。跳过半行。"""
    with open(path, "rb") as handle:
        handle.seek(start)
        chunk = handle.read()
    consumed = start + len(chunk)
    if chunk and not chunk.endswith(b"\n"):
        last_break = chunk.rfind(b"\n")
        if last_break == -1:
            return [], start  # 整段都是半行，等下次
        chunk = chunk[: last_break + 1]
        consumed = start + len(chunk)
    text = chunk.decode("utf-8", errors="replace")
    return text.splitlines(), consumed


def read_gzip_lines(path: str) -> list[str]:
    with gzip.open(path, "rb") as handle:
        return handle.read().decode("utf-8", errors="replace").splitlines()


def insert_event(conn: sqlite3.Connection, event: dict) -> None:
    if event["kind"] == "beacon":
        conn.execute(
            "INSERT INTO beacon_hits (ts, day, client, version, os, arch, install_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (event["ts"], event["day"], event["client"], event["version"],
             event["os"], event["arch"], event["install_id"]),
        )
    elif event["kind"] == "manifest":
        conn.execute(
            "INSERT INTO manifest_checks (day, count) VALUES (?, 1) "
            "ON CONFLICT(day) DO UPDATE SET count = count + 1",
            (event["day"],),
        )
    else:
        conn.execute(
            "INSERT INTO download_hits (ts, day, tag, filename) VALUES (?, ?, ?, ?)",
            (event["ts"], event["day"], event["tag"], event["filename"]),
        )


def process_log_path(conn: sqlite3.Connection, path: str) -> int:
    """按 inode 水位增量处理单个日志文件，返回本次新增事件数。

    关键点：logrotate 用 mv 轮转时 inode 不变、文件名改变，按 inode 记水位
    才不会把 access.log.1 的内容重复统计一遍。
    """
    try:
        stat = os.stat(path)
    except OSError:
        return 0
    row = conn.execute(
        "SELECT offset FROM progress WHERE inode = ?", (stat.st_ino,)
    ).fetchone()
    offset = min(row[0], stat.st_size) if row else 0
    if offset >= stat.st_size:
        conn.execute(
            "INSERT INTO progress (inode, offset) VALUES (?, ?) "
            "ON CONFLICT(inode) DO UPDATE SET offset = excluded.offset",
            (stat.st_ino, offset),
        )
        return 0

    lines, consumed = iter_log_lines(path, offset)
    count = 0
    for line in lines:
        event = parse_log_line(line)
        if event is None:
            continue
        count += 1
        insert_event(conn, event)
    conn.execute(
        "INSERT INTO progress (inode, offset) VALUES (?, ?) "
        "ON CONFLICT(inode) DO UPDATE SET offset = excluded.offset",
        (stat.st_ino, consumed),
    )
    return count


def init_db(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS progress (
            inode INTEGER PRIMARY KEY,
            offset INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS beacon_hits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL,
            day TEXT NOT NULL,
            client TEXT NOT NULL,
            version TEXT,
            os TEXT,
            arch TEXT,
            install_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_beacon_day ON beacon_hits (day);
        CREATE INDEX IF NOT EXISTS idx_beacon_install ON beacon_hits (install_id);
        CREATE TABLE IF NOT EXISTS download_hits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL,
            day TEXT NOT NULL,
            tag TEXT NOT NULL,
            filename TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_download_day ON download_hits (day);
        CREATE TABLE IF NOT EXISTS github_downloads (
            day TEXT NOT NULL,
            tag TEXT NOT NULL,
            filename TEXT NOT NULL,
            count INTEGER NOT NULL,
            PRIMARY KEY (day, tag, filename)
        );
        CREATE TABLE IF NOT EXISTS manifest_checks (
            day TEXT PRIMARY KEY,
            count INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS kv (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        """
    )
    return conn


def kv_get(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
    return row[0] if row else None


def kv_set(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO kv (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def collect_feedback_counts(db_path: str) -> dict[str, int] | None:
    """尽力只读反馈库取计数，供统计页展示；读不到时返回 None，不影响统计页生成。"""
    try:
        uri = f"file:{Path(db_path).as_posix()}?mode=ro"
        with closing(sqlite3.connect(uri, uri=True)) as conn:
            new = conn.execute("SELECT COUNT(*) FROM feedback WHERE status = 'new'").fetchone()[0]
            resolved = conn.execute("SELECT COUNT(*) FROM feedback WHERE status = 'resolved'").fetchone()[0]
            week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
            recent = conn.execute(
                "SELECT COUNT(*) FROM feedback WHERE created_at >= ?", (week_ago,)
            ).fetchone()[0]
        return {"new": new, "resolved": resolved, "recent": recent}
    except Exception:  # 数据库缺失、权限不足、表结构变化等一律跳过
        return None


def fetch_github_downloads(conn: sqlite3.Connection, repos: list[str], timeout: float, force: bool) -> bool:
    """尽力拉取 GitHub Releases 资产计数（累计值快照）。失败时静默返回 False。"""
    last = kv_get(conn, "github_last_fetch")
    if not force and last:
        try:
            if datetime.now(timezone.utc) - datetime.fromisoformat(last) < timedelta(hours=6):
                return True
        except ValueError:
            pass
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    seen: dict[tuple[str, str], int] = {}
    for repo in repos:
        url = f"https://api.github.com/repos/{repo}/releases?per_page=100"
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "LumaTile-Stats",
                    "Accept": "application/vnd.github+json",
                },
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                releases = json.loads(response.read().decode("utf-8"))
        except Exception as error:  # 网络/限流：跳过该仓库，不影响本地统计
            print(f"[warn] GitHub {repo} 拉取失败：{error}", file=sys.stderr)
            continue
        for release in releases:
            if release.get("draft"):
                continue
            tag = str(release.get("tag_name") or "")
            for asset in release.get("assets") or []:
                name = str(asset.get("name") or "")
                if not name.lower().endswith((".apk", ".exe", ".dmg", ".zip")):
                    continue
                if not tag or not name:
                    continue
                key = (tag, name)
                # 仓库改名期两个地址可能同时有效，取最大值避免重复计数
                seen[key] = max(seen.get(key, 0), int(asset.get("download_count") or 0))
    for (tag, filename), count in seen.items():
        conn.execute(
            "INSERT INTO github_downloads (day, tag, filename, count) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(day, tag, filename) DO UPDATE SET count = excluded.count",
            (today, tag, filename, count),
        )
    kv_set(conn, "github_last_fetch", datetime.now(timezone.utc).isoformat())
    return True


def collect_report(conn: sqlite3.Connection, days: int = 30) -> dict:
    """聚合最近 N 天数据供 HTML / JSON 报告使用。"""
    today = datetime.now().strftime("%Y-%m-%d")
    start = (datetime.now() - timedelta(days=days - 1)).strftime("%Y-%m-%d")

    daily_days = [row[0] for row in conn.execute(
        "SELECT DISTINCT day FROM beacon_hits WHERE day BETWEEN ? AND ? "
        "UNION SELECT DISTINCT day FROM download_hits WHERE day BETWEEN ? AND ? "
        "UNION SELECT day FROM manifest_checks WHERE day BETWEEN ? AND ? "
        "ORDER BY day", (start, today, start, today, start, today)
    )]
    # 从首个有数据的日期补到今天，避免停报时图表看起来仍是最新状态。
    all_days: list[str] = []
    if daily_days:
        cursor = datetime.strptime(daily_days[0], "%Y-%m-%d")
        end = datetime.strptime(today, "%Y-%m-%d")
        while cursor <= end:
            all_days.append(cursor.strftime("%Y-%m-%d"))
            cursor += timedelta(days=1)
    all_days = [d for d in all_days if d >= start]

    dau = {row[0]: row[1] for row in conn.execute(
        "SELECT day, COUNT(DISTINCT install_id) FROM beacon_hits "
        "WHERE day BETWEEN ? AND ? AND install_id IS NOT NULL GROUP BY day", (start, today)
    )}
    raw_beacons = {row[0]: row[1] for row in conn.execute(
        "SELECT day, COUNT(*) FROM beacon_hits WHERE day BETWEEN ? AND ? GROUP BY day", (start, today)
    )}
    manifest_checks = {row[0]: row[1] for row in conn.execute(
        "SELECT day, count FROM manifest_checks WHERE day BETWEEN ? AND ?", (start, today)
    )}
    downloads = {row[0]: row[1] for row in conn.execute(
        "SELECT day, COUNT(*) FROM download_hits WHERE day BETWEEN ? AND ? GROUP BY day", (start, today)
    )}

    new_installs = {row[0]: row[1] for row in conn.execute(
        "SELECT first_day, COUNT(*) FROM (SELECT install_id, MIN(day) AS first_day "
        "FROM beacon_hits WHERE install_id IS NOT NULL GROUP BY install_id) "
        "WHERE first_day BETWEEN ? AND ? GROUP BY first_day", (start, today)
    )}

    version_dist = [{"label": row[0] or "未知", "count": row[1]} for row in conn.execute(
        "SELECT COALESCE(version, ''), COUNT(DISTINCT install_id) FROM beacon_hits "
        "WHERE day BETWEEN ? AND ? AND install_id IS NOT NULL GROUP BY version ORDER BY 2 DESC",
        (start, today),
    )]
    os_dist = [{"label": row[0] or "未知", "count": row[1]} for row in conn.execute(
        "SELECT COALESCE(os, ''), COUNT(DISTINCT install_id) FROM beacon_hits "
        "WHERE day BETWEEN ? AND ? AND install_id IS NOT NULL GROUP BY os ORDER BY 2 DESC",
        (start, today),
    )]
    client_dist = [{"label": row[0] or "未知", "count": row[1]} for row in conn.execute(
        "SELECT client, COUNT(DISTINCT install_id) FROM beacon_hits "
        "WHERE day BETWEEN ? AND ? AND install_id IS NOT NULL GROUP BY client ORDER BY 2 DESC",
        (start, today),
    )]
    arch_dist = [{"label": row[0] or "未知", "count": row[1]} for row in conn.execute(
        "SELECT COALESCE(arch, ''), COUNT(DISTINCT install_id) FROM beacon_hits "
        "WHERE day BETWEEN ? AND ? AND install_id IS NOT NULL GROUP BY arch ORDER BY 2 DESC",
        (start, today),
    )]
    top_files = [{"label": row[0], "count": row[1]} for row in conn.execute(
        "SELECT CASE WHEN tag = '' THEN filename ELSE tag || ' / ' || filename END, COUNT(*) "
        "FROM download_hits WHERE day BETWEEN ? AND ? "
        "GROUP BY tag, filename ORDER BY 2 DESC LIMIT 10", (start, today),
    )]

    total_installs = conn.execute(
        "SELECT COUNT(DISTINCT install_id) FROM beacon_hits WHERE install_id IS NOT NULL"
    ).fetchone()[0]
    total_downloads = conn.execute("SELECT COUNT(*) FROM download_hits").fetchone()[0]
    total_beacons = conn.execute("SELECT COUNT(*) FROM beacon_hits").fetchone()[0]
    total_manifest_checks = conn.execute(
        "SELECT COALESCE(SUM(count), 0) FROM manifest_checks"
    ).fetchone()[0]

    github_snapshot_day = conn.execute("SELECT MAX(day) FROM github_downloads").fetchone()[0]
    github_total = conn.execute("SELECT COALESCE(SUM(count), 0) FROM github_downloads g "
                                "WHERE day = ?", (github_snapshot_day,)).fetchone()[0]
    github_by_asset = [{"label": f"{row[0]} / {row[1]}", "count": row[2]} for row in conn.execute(
        "SELECT tag, filename, count FROM github_downloads "
        "WHERE day = (SELECT MAX(day) FROM github_downloads) ORDER BY count DESC LIMIT 10"
    )]

    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "range_days": days,
        "days": all_days,
        "dau": [dau.get(d, 0) for d in all_days],
        "raw_checks": [raw_beacons.get(d, 0) + manifest_checks.get(d, 0) for d in all_days],
        "downloads": [downloads.get(d, 0) for d in all_days],
        "new_installs": [new_installs.get(d, 0) for d in all_days],
        "version_dist": version_dist,
        "os_dist": os_dist,
        "client_dist": client_dist,
        "arch_dist": arch_dist,
        "top_files": top_files,
        "totals": {
            "installs": total_installs,
            "downloads_selfhosted": total_downloads,
            "beacons": total_beacons,
            "manifest_checks": total_manifest_checks,
            "update_checks": total_beacons + total_manifest_checks,
            "downloads_github": github_total,
        },
        "github_snapshot_day": github_snapshot_day,
        "github_by_asset": github_by_asset,
    }


def svg_line(values: list[int], labels: list[str], color: str, title: str) -> str:
    width, height, pad = 640, 180, 30
    max_value = max(values, default=0)
    count = max(len(values), 1)
    step = (width - pad * 2) / max(count - 1, 1)
    points = [
        (pad + i * step, height - pad - (value / max_value) * (height - pad * 2) if max_value else height - pad)
        for i, value in enumerate(values)
    ]
    polyline = " ".join(f"{x:.1f},{y:.1f}" for x, y in points)
    area = f"{pad},{height - pad} " + polyline + f" {pad + (count - 1) * step:.1f},{height - pad}"
    dots = "".join(
        f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4" fill="{color}" tabindex="0">'
        f'<title>{html.escape(label)}：{value}</title></circle>'
        for (x, y), label, value in zip(points, labels, values)
    )
    every = max(count // 6, 1)
    text_points = " ".join(
        f'<text x="{x:.1f}" y="{height - 8}" font-size="9" fill="#889" text-anchor="middle">{label[5:]}</text>'
        for i, ((x, _), label) in enumerate(zip(points, labels))
        if i % every == 0
    )
    return f"""<svg viewBox="0 0 {width} {height}" role="img" aria-label="{html.escape(title)}">
      <polyline fill="{color}22" stroke="none" points="{area}" />
      <polyline fill="none" stroke="{color}" stroke-width="2" points="{polyline}" />
      {dots}
      {text_points}
    </svg>"""


def svg_bars(values: list[int], labels: list[str], color: str, title: str) -> str:
    width, height, pad = 640, 180, 30
    max_value = max(values, default=0)
    count = max(len(values), 1)
    step = (width - pad * 2) / count
    bars = []
    for i, value in enumerate(values):
        bar_height = (value / max_value) * (height - pad * 2) if max_value else 0
        x = pad + i * step + step * 0.12
        bars.append(
            f'<rect x="{x:.1f}" y="{height - pad - bar_height:.1f}" width="{step * 0.76:.1f}" '
            f'height="{bar_height:.1f}" fill="{color}"><title>{labels[i]}：{value}</title></rect>'
        )
    text_points = " ".join(
        f'<text x="{pad + i * step + step / 2:.1f}" y="{height - 8}" font-size="9" fill="#889" '
        f'text-anchor="middle">{label[5:]}</text>'
        for i, label in enumerate(labels)
        if i % max(count // 6, 1) == 0
    )
    return f"""<svg viewBox="0 0 {width} {height}" role="img" aria-label="{title}">
      {''.join(bars)}
      {text_points}
    </svg>"""


def dist_table(title: str, rows: list[dict], total: int | None = None) -> str:
    if not rows:
        return f'<section class="card"><h3>{title}</h3><p class="muted">暂无数据</p></section>'
    max_count = max(1, max(row["count"] for row in rows))
    body = "".join(
        f'<tr><td class="label">{html.escape(str(row["label"]))}</td>'
        f'<td class="bar-cell"><div class="bar" style="width:{row["count"] / max_count * 100:.0f}%"></div></td>'
        f'<td class="num">{row["count"]}</td></tr>'
        for row in rows
    )
    suffix = f'<p class="muted">合计 {total}</p>' if total is not None else ""
    return f"""<section class="card"><h3>{title}</h3>
      <table><tbody>{body}</tbody></table>{suffix}</section>"""


def daily_table(report: dict) -> str:
    rows = "".join(
        f'<tr><td><time datetime="{day}">{day}</time></td><td>{dau}</td><td>{new}</td>'
        f'<td>{checks}</td><td>{downloads}</td></tr>'
        for day, dau, new, checks, downloads in reversed(list(zip(
            report["days"], report["dau"], report["new_installs"],
            report["raw_checks"], report["downloads"],
        )))
    )
    if not rows:
        rows = '<tr><td colspan="5" class="empty">暂无每日数据</td></tr>'
    return f"""<details class="card daily-detail">
      <summary>每日精确数据 <span>展开查看 {len(report['days'])} 天明细</span></summary>
      <div class="table-scroll"><table>
        <thead><tr><th>日期</th><th>日活</th><th>新增安装</th><th>更新检查</th><th>下载</th></tr></thead>
        <tbody>{rows}</tbody>
      </table></div>
    </details>"""


def render_html(report: dict, feedback: dict[str, int] | None = None) -> str:
    labels = report["days"]
    totals = report["totals"]
    dau_chart = svg_line(report["dau"], labels, "#4f6ef7", "日活")
    download_chart = svg_bars(report["downloads"], labels, "#18a058", "每日下载")
    check_chart = svg_line(report["raw_checks"], labels, "#e2a03f", "更新检查")
    new_chart = svg_bars(report["new_installs"], labels, "#8a63f4", "新增安装")

    card_rows = [
        ("识别的安装", totals["installs"], "累计去重"),
        ("更新检查", totals["update_checks"], f'含匿名心跳 {totals["beacons"]} 次'),
        ("自建源下载", totals["downloads_selfhosted"], "累计请求"),
        ("GitHub 下载", totals["downloads_github"], report["github_snapshot_day"] or "暂无快照"),
    ]
    cards = "".join(
        f'<div class="stat"><div class="stat-label">{label}</div>'
        f'<div class="stat-num">{value}</div><div class="stat-note">{note}</div></div>'
        for label, value, note in card_rows
    )
    if feedback is not None:
        feedback_panel = (
            '<section class="feedback-panel"><div><p class="eyebrow">反馈队列</p>'
            f'<h2><strong>{feedback["new"]}</strong> 条待处理</h2>'
            f'<p>已处理 {feedback["resolved"]} 条 · 近 7 天新增 {feedback["recent"]} 条</p></div>'
            '<a class="button" href="/admin/">查看全部反馈 <span aria-hidden="true">→</span></a></section>'
        )
    else:
        feedback_panel = (
            '<section class="feedback-panel unavailable"><div><p class="eyebrow">反馈队列</p>'
            '<h2>反馈统计暂不可用</h2><p>统计任务未能读取反馈数据库，仍可直接进入管理页。</p></div>'
            '<a class="button" href="/admin/">打开反馈管理 <span aria-hidden="true">→</span></a></section>'
        )
    range_days = report["range_days"]
    github_title = (
        f'GitHub 下载（{report["github_snapshot_day"]} 快照）'
        if report["github_snapshot_day"] else "GitHub 下载（暂无快照）"
    )
    return f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>LumaTile 统计</title>
<style>
  :root {{ --ink: #172038; --muted: #657089; --line: #dbe2ec; --paper: #fff;
    --canvas: #eef3f8; --blue: #3559e0; --green: #0f9d78; --amber: #d48222; --violet: #7651c9; }}
  * {{ box-sizing: border-box; }}
  body {{ font-family: "Segoe UI Variable", "Microsoft YaHei UI", system-ui, sans-serif; margin: 0;
    background: var(--canvas); color: var(--ink); }}
  body::before {{ content: ""; position: fixed; inset: 0 0 auto; height: 4px;
    background: linear-gradient(90deg, var(--blue) 0 42%, var(--green) 42% 67%, var(--amber) 67% 84%, var(--violet) 84%); }}
  main {{ max-width: 1120px; margin: 0 auto; padding: 48px 24px 64px; }}
  h1 {{ font: 700 clamp(30px, 5vw, 52px)/1.05 "Segoe UI Variable Display", "Microsoft YaHei UI", sans-serif;
    letter-spacing: -.04em; margin: 7px 0 12px; }}
  h2 {{ font-size: 20px; margin: 4px 0; }} h3 {{ font-size: 14px; margin: 0 0 14px; }}
  p {{ margin: 0; }} a {{ color: var(--blue); }}
  .masthead {{ display: flex; justify-content: space-between; gap: 32px; align-items: end; margin-bottom: 28px; }}
  .eyebrow {{ color: var(--blue); font: 700 11px/1.2 ui-monospace, Consolas, monospace; letter-spacing: .13em; text-transform: uppercase; }}
  .updated {{ max-width: 430px; color: var(--muted); font-size: 13px; line-height: 1.6; }}
  .live {{ flex: 0 0 auto; border: 1px solid var(--line); border-radius: 999px; background: rgba(255,255,255,.7);
    padding: 8px 12px; color: var(--muted); font: 600 12px ui-monospace, Consolas, monospace; }}
  .live::before {{ content: ""; display: inline-block; width: 7px; height: 7px; margin-right: 7px;
    border-radius: 50%; background: var(--green); box-shadow: 0 0 0 3px #0f9d7822; }}
  .cards {{ display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--line);
    border-radius: 16px; overflow: hidden; background: var(--paper); box-shadow: 0 16px 40px rgba(23,32,56,.06); }}
  .stat {{ min-width: 0; padding: 20px; border-right: 1px solid var(--line); }} .stat:last-child {{ border-right: 0; }}
  .stat-num {{ margin: 8px 0 3px; font: 720 30px/1 ui-monospace, Consolas, monospace; letter-spacing: -.06em; }}
  .stat-label, .stat-note {{ color: var(--muted); font-size: 12px; }} .stat-label {{ font-weight: 650; color: var(--ink); }}
  .feedback-panel {{ display: flex; align-items: center; justify-content: space-between; gap: 24px; margin: 16px 0 38px;
    padding: 20px 22px; border: 1px solid #cbd6ff; border-radius: 16px; background: #f7f9ff; }}
  .feedback-panel h2 strong {{ color: var(--blue); font: 750 28px ui-monospace, Consolas, monospace; }}
  .feedback-panel p:not(.eyebrow) {{ color: var(--muted); font-size: 13px; }}
  .feedback-panel.unavailable {{ border-color: var(--line); background: var(--paper); }}
  .button {{ flex: 0 0 auto; border-radius: 10px; background: var(--blue); color: #fff; padding: 10px 14px;
    font-size: 13px; font-weight: 650; text-decoration: none; }} .button:focus-visible, summary:focus-visible {{ outline: 3px solid #3559e055; outline-offset: 3px; }}
  .section-head {{ display: flex; justify-content: space-between; align-items: baseline; gap: 16px; margin: 34px 0 12px; }}
  .section-head h2 {{ margin: 0; }} .section-head p {{ color: var(--muted); font-size: 12px; }}
  .chart-grid, .dist-grid {{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }}
  .card {{ min-width: 0; background: var(--paper); border: 1px solid var(--line); border-radius: 14px; padding: 18px; }}
  svg {{ display: block; width: 100%; height: auto; overflow: visible; }} svg circle:focus {{ outline: none; stroke: #fff; stroke-width: 2; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 13px; }} th {{ color: var(--muted); font-size: 11px; text-align: left; }}
  td, th {{ padding: 7px 6px; border-bottom: 1px solid #edf0f5; }} tbody tr:last-child td {{ border-bottom: 0; }}
  td:not(:first-child), th:not(:first-child) {{ text-align: right; }}
  .bar-cell {{ width: 52%; }} .bar {{ height: 9px; border-radius: 2px; background: var(--blue); min-width: 2px; }}
  .num {{ text-align: right; font: 600 12px ui-monospace, Consolas, monospace; }}
  .muted {{ color: var(--muted); font-size: 12px; margin-top: 10px; }}
  .daily-detail {{ margin-top: 14px; padding: 0; }} .daily-detail summary {{ cursor: pointer; padding: 16px 18px; font-size: 13px; font-weight: 650; }}
  .daily-detail summary span {{ float: right; color: var(--muted); font-weight: 400; }} .daily-detail[open] summary {{ border-bottom: 1px solid var(--line); }}
  .table-scroll {{ max-height: 390px; overflow: auto; padding: 8px 14px 14px; }} .empty {{ color: var(--muted); text-align: center !important; }}
  footer {{ margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; line-height: 1.6; }}
  @media (max-width: 760px) {{ main {{ padding: 36px 14px 48px; }} .masthead {{ align-items: start; flex-direction: column; gap: 14px; }}
    .cards {{ grid-template-columns: repeat(2, 1fr); }} .stat:nth-child(2) {{ border-right: 0; }} .stat:nth-child(-n+2) {{ border-bottom: 1px solid var(--line); }}
    .chart-grid, .dist-grid {{ grid-template-columns: 1fr; }} .feedback-panel {{ align-items: stretch; flex-direction: column; }} .button {{ text-align: center; }} }}
  @media (max-width: 420px) {{ .cards {{ grid-template-columns: 1fr; }} .stat {{ border-right: 0; border-bottom: 1px solid var(--line); }}
    .stat:nth-child(3) {{ border-bottom: 1px solid var(--line); }} .stat:last-child {{ border-bottom: 0; }} .daily-detail summary span {{ display: none; }} }}
</style></head><body><main>
<header class="masthead"><div><p class="eyebrow">LumaTile / Operations</p><h1>更新源统计</h1>
<p class="updated">匿名观测安装、更新与下载状态，不包含账号、成绩或网络地址。</p></div>
<div class="live">生成于 {report['generated_at']}</div></header>
<div class="cards">{cards}</div>
{feedback_panel}
<div class="section-head"><h2>最近 {range_days} 天趋势</h2><p>悬停数据点，或展开下方精确数据</p></div>
<div class="chart-grid">
  <section class="card"><h3>日活 · 去重安装</h3>{dau_chart}</section>
  <section class="card"><h3>每日新增安装</h3>{new_chart}</section>
  <section class="card"><h3>更新检查 · 含旧版客户端</h3>{check_chart}</section>
  <section class="card"><h3>自建源每日下载</h3>{download_chart}</section>
</div>
{daily_table(report)}
<div class="section-head"><h2>构成与下载</h2><p>安装分布按随机安装编号去重</p></div>
<div class="dist-grid">
  {dist_table(f"版本分布（近 {range_days} 天）", report["version_dist"])}
  {dist_table(f"系统分布（近 {range_days} 天）", report["os_dist"])}
  {dist_table(f"客户端分布（近 {range_days} 天）", report["client_dist"])}
  {dist_table(f"架构分布（近 {range_days} 天）", report["arch_dist"])}
  {dist_table(f"自建源下载明细（近 {range_days} 天）", report["top_files"])}
  {dist_table(github_title, report["github_by_asset"], totals["downloads_github"])}
</div>
<footer>口径：日活按匿名安装编号每日去重；“识别的安装”按全量历史去重；旧版客户端（v2.0.0 之前）仅计入更新检查；自建源 206 断点续传按请求计数；GitHub 数据为官方 API 累计快照。</footer>
</main></body></html>"""


def load_config(path: Path) -> dict:
    config = {
        # 只处理未压缩的当前日志和上一份轮转日志；.gz 是新 inode，无法可靠去重，
        # 服务器宕机跨天时该天统计会缺失，属可接受代价
        "log_paths": [
            "/var/log/nginx/lumatile.access.log",
            "/var/log/nginx/lumatile.access.log.1",
        ],
        "db_path": "/opt/lumatile-stats/stats.db",
        "report_dir": "/opt/lumatile-stats/report",
        "github_repos": ["C1ouDreamW/qlu-toolbox", "C1ouDreamW/lumatile"],
        "github_timeout": 10,
        "range_days": 30,
    }
    if path.exists():
        config.update(json.loads(path.read_text(encoding="utf-8")))
    return config


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="LumaTile 更新源统计")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--force-github", action="store_true", help="忽略节流强制拉取 GitHub 计数")
    parser.add_argument("--skip-github", action="store_true", help="本次不拉取 GitHub 计数")
    args = parser.parse_args(argv)

    config = load_config(args.config)
    db_path = Path(config["db_path"])
    db_path.parent.mkdir(parents=True, exist_ok=True)
    report_dir = Path(config["report_dir"])
    report_dir.mkdir(parents=True, exist_ok=True)

    conn = init_db(db_path)
    try:
        total_new = sum(process_log_path(conn, log_path) for log_path in config["log_paths"])
        if not args.skip_github:
            fetch_github_downloads(
                conn, config["github_repos"], float(config["github_timeout"]), args.force_github
            )
        report = collect_report(conn, int(config.get("range_days", 30)))
        feedback = collect_feedback_counts(str(config.get("feedback_db_path", "")))
        conn.commit()
    finally:
        conn.close()

    (report_dir / "stats.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (report_dir / "stats.html").write_text(render_html(report, feedback), encoding="utf-8")
    os.chmod(report_dir / "stats.json", 0o644)
    os.chmod(report_dir / "stats.html", 0o644)
    print(f"[ok] 新增事件 {total_new}，报告已写入 {report_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
