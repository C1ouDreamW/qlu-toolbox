from __future__ import annotations

import argparse
import sys


def configure_streams() -> None:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="一格有光")
    parser.add_argument("--bridge", action="store_true")
    parser.add_argument("--worker", choices=("grade-export", "schedule-import"))
    parser.add_argument("--year")
    parser.add_argument("--semester")
    parser.add_argument("--output")
    parser.add_argument("--browser", default="auto")
    parser.add_argument("--keep-login", choices=("yes", "no"), default="yes")
    parser.add_argument("--event-file")
    return parser


def main() -> int:
    configure_streams()
    arguments = build_parser().parse_args()
    if arguments.bridge:
        from qlu_toolbox.bridge import bridge_main

        return bridge_main()
    if arguments.worker == "grade-export":
        missing = [
            name
            for name in ("year", "semester", "output")
            if not getattr(arguments, name)
        ]
        if missing:
            raise SystemExit(f"后台任务缺少参数：{', '.join(missing)}")
        from qlu_toolbox.modules.grade_export.worker import worker_main

        return worker_main(
            arguments.year,
            arguments.semester,
            arguments.output,
            arguments.browser,
            arguments.keep_login == "yes",
            arguments.event_file,
        )
    if arguments.worker == "schedule-import":
        from qlu_toolbox.modules.schedule_import.worker import worker_main

        return worker_main(
            arguments.browser,
            arguments.keep_login == "yes",
            arguments.event_file,
        )

    print("一格有光桌面界面使用 Vue 3 + Electron。请使用 npm run dev 启动开发版。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
