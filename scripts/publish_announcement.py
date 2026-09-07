#!/usr/bin/env python3
"""发布或清除 LumaTile 更新源公告。

用法：
  uv run scripts/publish_announcement.py --title "新版本上线" --body "v2.1.0 已发布…" [--days 7]
  uv run scripts/publish_announcement.py --clear

公告会上传到更新源 stable/announcement.json，客户端启动时拉取展示（同 id 只展示一次）。
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

REMOTE_HOST = "root@ishua.cloud"
REMOTE_PATH = "/opt/lumatile-update/data/stable/announcement.json"
PUBLIC_URL = "https://lumatile.ishua.cloud/stable/announcement.json"


def build_announcement(args: argparse.Namespace) -> dict:
    announcement: dict = {
        "schemaVersion": 1,
        "id": args.id or f"{datetime.now(timezone.utc).strftime('%Y%m%d')}-{os.urandom(2).hex()}",
        "title": args.title,
        "body": args.body.replace("\\n", "\n"),
        "level": args.level,
    }
    if args.url:
        announcement["url"] = args.url
    if args.days > 0:
        expires = datetime.now(timezone.utc) + timedelta(days=args.days)
        announcement["expiresAt"] = expires.strftime("%Y-%m-%dT%H:%M:%SZ")
    return announcement


def run(command: list[str]) -> None:
    result = subprocess.run(command)
    if result.returncode != 0:
        raise SystemExit(f"命令失败：{' '.join(command)}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="发布或清除 LumaTile 更新源公告")
    parser.add_argument("--title", help="公告标题")
    parser.add_argument("--body", help="公告正文（支持 \\n 换行）")
    parser.add_argument("--level", choices=["info", "warning"], default="info")
    parser.add_argument("--url", default=None, help="可选的“查看详情”链接（https）")
    parser.add_argument("--days", type=int, default=7, help="有效期天数，默认 7；0 表示永不过期")
    parser.add_argument("--id", default=None, help="公告 id，默认按日期+随机生成；同 id 客户端只弹一次")
    parser.add_argument("--clear", action="store_true", help="删除服务器上的公告")
    parser.add_argument("--host", default=REMOTE_HOST)
    parser.add_argument("--remote-path", default=REMOTE_PATH)
    parser.add_argument("--public-url", default=PUBLIC_URL)
    args = parser.parse_args(argv)

    if args.clear:
        run(["ssh", args.host, f"rm -f -- {shlex.quote(args.remote_path)}"])
        print("公告已清除")
        return 0

    if not args.title or not args.body:
        parser.error("发布公告需要 --title 和 --body（清除请用 --clear）")

    announcement = build_announcement(args)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as handle:
        json.dump(announcement, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        temp_path = handle.name
    try:
        remote_temp = f"{args.remote_path}.{os.urandom(6).hex()}.tmp"
        run(["scp", temp_path, f"{args.host}:{remote_temp}"])
        run(["ssh", args.host, f"mv -f -- {shlex.quote(remote_temp)} {shlex.quote(args.remote_path)}"])
    finally:
        os.unlink(temp_path)

    print(f"公告已发布：{announcement['id']}（{args.title}）")
    verify = subprocess.run(["curl", "-fsS", args.public_url], capture_output=True, text=True)
    try:
        verified = verify.returncode == 0 and json.loads(verify.stdout).get("id") == announcement["id"]
    except (ValueError, AttributeError):
        verified = False
    if verified:
        print("线上校验通过")
    else:
        print(f"[warn] 无法通过 {args.public_url} 校验，请手动确认", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
