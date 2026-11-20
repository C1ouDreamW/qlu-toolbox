from __future__ import annotations

import argparse
import fcntl
import os
import re
import shutil
import signal
import sqlite3
import tempfile
import time
import traceback
from collections.abc import Callable
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from stats import collect

DATA = Path("/data")
UPDATES = Path("/updates")
STATS = Path("/stats")
LOGS = Path("/logs")
BACKUPS = Path("/backups")
SHANGHAI = timezone(timedelta(hours=8), "Asia/Shanghai")
RETENTION = timedelta(days=14)


def collect_stats(*, force_github: bool = False, skip_github: bool = False) -> None:
    host_logs = os.environ.get("LUMATILE_ACCESS_LOG_FORMAT") == "host"
    logs = [] if host_logs else sorted(LOGS.glob("lumatile-access-????-??-??.log"))
    config = collect.load_config()
    config.update(
        log_paths=[LOGS / "lumatile.access.log", LOGS / "lumatile.access.log.1"] if host_logs else [],
        dated_log_paths=logs,
        db_path=STATS / "stats.db",
        report_dir=STATS / "report",
        feedback_db_path=DATA / "feedback.db",
    )
    collect.run_collection(config, force_github=force_github, skip_github=skip_github)
    cutoff = (datetime.now(SHANGHAI) - RETENTION).timestamp()
    for path in logs:
        if path.stat().st_mtime < cutoff:
            path.unlink()


def backup() -> None:
    databases = (DATA / "portal.db", DATA / "feedback.db", STATS / "stats.db")
    backup_time = datetime.now(timezone.utc)
    with tempfile.TemporaryDirectory(dir=BACKUPS, prefix=".backup.") as directory:
        staging = Path(directory)
        for source in databases:
            if not source.is_file():
                continue
            with (
                closing(sqlite3.connect(f"{source.as_uri()}?mode=ro", uri=True)) as original,
                closing(sqlite3.connect(staging / source.name)) as snapshot,
            ):
                original.backup(snapshot)
                if snapshot.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                    raise RuntimeError(f"备份完整性检查失败：{source.name}")

        if not any(staging.glob("*.db")):
            print("[backup] 尚无数据库可备份")
            return

        for relative in ("stable/announcement.json", "alpha/announcement.json", "android/server.json"):
            try:
                content = (UPDATES / relative).read_bytes()
            except FileNotFoundError:
                continue
            destination = staging / relative
            destination.parent.mkdir(exist_ok=True)
            destination.write_bytes(content)

        target = BACKUPS / backup_time.strftime("%Y%m%dT%H%M%S%fZ")
        staging.rename(target)
        print(f"[backup] 已保存至 {target}")

    cutoff = (backup_time - RETENTION).timestamp()
    for path in BACKUPS.iterdir():
        if re.fullmatch(r"\d{8}T\d{6}(?:\d{6})?Z", path.name) and path.is_dir() and path.stat().st_mtime < cutoff:
            shutil.rmtree(path)


def run_job(name: str, action: Callable[[], None], due: date | None = None) -> None:
    with (STATS / f".{name}.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = STATS / f".{name}.last-run"
        if due is not None and state.is_file() and state.read_text().strip() >= due.isoformat():
            return
        action()
        if due is not None:
            collect.write_report(state, due.isoformat() + "\n")


def schedule() -> None:
    print("[jobs] 统计 00:25，备份 01:25（北京时间）")
    while True:
        for name, hour, action in (("collect", 0, collect_stats), ("backup", 1, backup)):
            now = datetime.now(SHANGHAI)
            due = now.replace(hour=hour, minute=25, second=0, microsecond=0)
            if now < due:
                due -= timedelta(days=1)
            try:
                run_job(name, action, due.date())
            except Exception:
                traceback.print_exc()
        time.sleep(60)


def stop(_signum, _frame) -> None:
    raise SystemExit(0)


def main() -> None:
    parser = argparse.ArgumentParser(description="LumaTile 统计与备份任务")
    commands = parser.add_subparsers(dest="command", required=True)
    stats_command = commands.add_parser("collect")
    stats_command.add_argument("--force-github", action="store_true")
    stats_command.add_argument("--skip-github", action="store_true")
    commands.add_parser("backup")
    commands.add_parser("schedule")
    args = parser.parse_args()

    signal.signal(signal.SIGTERM, stop)
    if args.command == "schedule":
        schedule()
    elif args.command == "backup":
        run_job("backup", backup)
    else:
        run_job("collect", lambda: collect_stats(force_github=args.force_github, skip_github=args.skip_github))


if __name__ == "__main__":
    main()
