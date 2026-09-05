from __future__ import annotations

import json
import sys
import threading

from .domain import ImportOptions
from .service import run_import


def worker_main(
    preferred_browser: str,
    keep_login_state: bool,
    event_file: str | None = None,
) -> int:
    cancel_event = threading.Event()
    continue_event = threading.Event()
    browser_ready_event = threading.Event()

    def emit(event: dict[str, object]) -> None:
        serialized = json.dumps(event, ensure_ascii=False)
        if event_file:
            from pathlib import Path

            try:
                path = Path(event_file)
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open("a", encoding="utf-8", newline="\n") as handle:
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
    options = ImportOptions(
        preferred_browser=preferred_browser,
        keep_login_state=keep_login_state,
    )
    return run_import(options, emit, cancel_event, continue_event, browser_ready_event)
