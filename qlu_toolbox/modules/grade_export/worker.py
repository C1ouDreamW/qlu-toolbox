from __future__ import annotations

import json
import sys
import threading
from pathlib import Path

from .domain import ExportOptions
from .service import run_export


def worker_main(
    academic_year: str,
    semester_value: str,
    output_dir: str,
    preferred_browser: str,
    keep_login_state: bool,
    event_file: str | None = None,
) -> int:
    cancel_event = threading.Event()
    continue_event = threading.Event()
    browser_ready_event = threading.Event()
    event_path = Path(event_file) if event_file else None
    event_sequence = 0

    def emit(event: dict[str, object]) -> None:
        nonlocal event_sequence
        event_sequence += 1
        payload = {**event, "_seq": event_sequence}
        serialized = json.dumps(payload, ensure_ascii=False)

        # PyInstaller 的 Windows 图形进程偶尔无法把 stdout 管道交给子进程。
        # 事件文件是可靠通道，stdout 保留给源码运行和命令行诊断使用。
        if event_path is not None:
            try:
                event_path.parent.mkdir(parents=True, exist_ok=True)
                with event_path.open("a", encoding="utf-8", newline="\n") as handle:
                    handle.write(serialized + "\n")
                    handle.flush()
            except OSError:
                pass
        try:
            print(serialized, flush=True)
        except (AttributeError, OSError):
            pass

    def listen() -> None:
        for line in sys.stdin:
            try:
                command = json.loads(line).get("command")
            except (ValueError, TypeError):
                continue
            if command == "cancel":
                cancel_event.set()
            elif command == "continue":
                continue_event.set()
            elif command == "browser-ready":
                browser_ready_event.set()

    threading.Thread(target=listen, daemon=True).start()
    options = ExportOptions(
        academic_year=academic_year,
        semester_value=semester_value,
        output_dir=Path(output_dir),
        preferred_browser=preferred_browser,
        keep_login_state=keep_login_state,
    )
    return run_export(options, emit, cancel_event, continue_event, browser_ready_event)
