from __future__ import annotations

import json
import os
import re
import signal
import shutil
import subprocess
import sys
import threading
from dataclasses import asdict
from pathlib import Path
from typing import Any

from qlu_toolbox import __version__
from qlu_toolbox.core.browser_component import (
    browser_component_status,
    browser_install_command,
    configure_browser_environment,
)
from qlu_toolbox.core.metadata import (
    AUTHOR_EMAIL,
    AUTHOR_GITHUB_URL,
    AUTHOR_NAME,
    ISSUES_URL,
    RELEASES_URL,
    REPOSITORY_URL,
)
from qlu_toolbox.core.paths import AppPaths
from qlu_toolbox.core.settings import AppSettings, SettingsStore
from qlu_toolbox.core.tasks import TaskStore
from qlu_toolbox.modules.grade_export import MANIFEST
from qlu_toolbox.modules.grade_export.domain import SEMESTERS, default_academic_year, validate_academic_year
from qlu_toolbox.modules.gpa_calculator import MANIFEST as GPA_MANIFEST
from qlu_toolbox.modules.gpa_calculator.domain import parse_grade_xlsx


class Bridge:
    def __init__(self) -> None:
        self.paths = AppPaths.discover()
        self.paths.ensure()
        configure_browser_environment(self.paths)
        self.settings_store = SettingsStore(self.paths)
        self.settings = self.settings_store.load()
        self.tasks = TaskStore(self.paths.data_dir / "tasks.sqlite3")
        self.worker: subprocess.Popen[str] | None = None
        self.worker_task_id: str | None = None
        self.lock = threading.Lock()
        self.write_lock = threading.Lock()
        self.browser_lock = threading.Lock()
        self.browser_install_process: subprocess.Popen[str] | None = None
        self.browser_installing = False
        self.browser_install_cancelled = False

    def emit(self, payload: dict[str, Any]) -> None:
        with self.write_lock:
            print(json.dumps(payload, ensure_ascii=False), flush=True)

    def respond(self, request_id: str, result: Any = None, error: str = "") -> None:
        payload: dict[str, Any] = {"channel": "response", "id": request_id}
        if error:
            payload["error"] = error
        else:
            payload["result"] = result
        self.emit(payload)

    def handle(self, request: dict[str, Any]) -> Any:
        method = str(request.get("method", ""))
        params = request.get("params") or {}
        handlers = {
            "bootstrap": self.bootstrap,
            "saveSettings": self.save_settings,
            "listTasks": self.list_tasks,
            "clearTasks": self.clear_tasks,
            "clearProfiles": self.clear_profiles,
            "clearLogs": self.clear_logs,
            "browserComponentStatus": self.get_browser_component_status,
            "startBrowserInstall": self.start_browser_install,
            "cancelBrowserInstall": self.cancel_browser_install,
            "removeBrowserComponent": self.remove_browser_component,
            "startGradeExport": self.start_grade_export,
            "gradeCommand": self.grade_command,
            "parseGradeWorkbook": self.parse_grade_workbook,
        }
        if method not in handlers:
            raise ValueError(f"未知操作：{method}")
        return handlers[method](params)

    def bootstrap(self, _params: dict[str, Any]) -> dict[str, Any]:
        return {
            "version": __version__,
            "settings": asdict(self.settings),
            "tasks": [asdict(item) for item in self.tasks.list_recent()],
            "defaultAcademicYear": default_academic_year(),
            "semesters": SEMESTERS,
            "tool": asdict(MANIFEST),
            "tools": [asdict(MANIFEST), asdict(GPA_MANIFEST)],
            "browserComponent": self.get_browser_component_status({}),
            "paths": {
                "settings": str(self.settings_store.path),
                "tasks": str(self.paths.data_dir / "tasks.sqlite3"),
                "logs": str(self.paths.log_dir),
                "profiles": str(self.paths.profile_dir),
                "browsers": str(self.paths.browser_dir),
                "data": str(self.paths.data_dir),
            },
            "metadata": {
                "author": AUTHOR_NAME,
                "email": AUTHOR_EMAIL,
                "github": AUTHOR_GITHUB_URL,
                "repository": REPOSITORY_URL,
                "issues": ISSUES_URL,
                "releases": RELEASES_URL,
            },
        }

    def save_settings(self, params: dict[str, Any]) -> dict[str, Any]:
        allowed = {key for key in asdict(AppSettings())}
        current = asdict(self.settings)
        current.update({key: value for key, value in params.items() if key in allowed})
        self.settings = AppSettings(**current).normalized()
        self.settings_store.save(self.settings)
        return asdict(self.settings)

    @staticmethod
    def parse_grade_workbook(params: dict[str, Any]) -> dict[str, object]:
        file_path = str(params.get("filePath", "")).strip()
        if not file_path:
            raise ValueError("请选择 XLSX 成绩文件")
        return parse_grade_xlsx(file_path)

    def list_tasks(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        limit = max(1, min(int(params.get("limit", 100)), 1000))
        return [asdict(item) for item in self.tasks.list_recent(limit)]

    def clear_tasks(self, _params: dict[str, Any]) -> bool:
        self.tasks.clear()
        return True

    def clear_profiles(self, _params: dict[str, Any]) -> bool:
        self._clear_directory(self.paths.profile_dir)
        return True

    def clear_logs(self, _params: dict[str, Any]) -> bool:
        self._clear_directory(self.paths.log_dir)
        return True

    def get_browser_component_status(self, _params: dict[str, Any]) -> dict[str, Any]:
        status = browser_component_status(self.paths)
        with self.browser_lock:
            status["installing"] = self.browser_installing
        return status

    def start_browser_install(self, _params: dict[str, Any]) -> dict[str, Any]:
        status = self.get_browser_component_status({})
        if status["installed"]:
            self._send_worker_command("browser-ready")
            return status
        with self.browser_lock:
            if self.browser_installing:
                return {**status, "installing": True}
            self.browser_installing = True
            self.browser_install_cancelled = False
        threading.Thread(target=self._install_browser_component, daemon=True).start()
        return {**status, "installing": True}

    def cancel_browser_install(self, _params: dict[str, Any]) -> bool:
        with self.browser_lock:
            if not self.browser_installing:
                return False
            self.browser_install_cancelled = True
            process = self.browser_install_process
        if process is not None and process.poll() is None:
            self._terminate_process_tree(process)
        return True

    @staticmethod
    def _terminate_process_tree(process: subprocess.Popen[str]) -> None:
        if process.poll() is not None:
            return
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW,
                check=False,
            )
            return
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            process.kill()

    def remove_browser_component(self, _params: dict[str, Any]) -> dict[str, Any]:
        with self.browser_lock:
            if self.browser_installing:
                raise RuntimeError("浏览器组件正在下载，请先取消下载")
        with self.lock:
            if self.worker is not None and self.worker.poll() is None:
                raise RuntimeError("分项成绩任务正在运行，暂时不能删除浏览器组件")
        self._clear_directory(self.paths.browser_dir)
        return self.get_browser_component_status({})

    def _emit_browser_event(self, event: dict[str, Any]) -> None:
        self.emit({"channel": "event", "name": "browserComponent", "event": event})

    def _install_browser_component(self) -> None:
        progress = 0
        phase = "browser"
        diagnostics: list[str] = []
        try:
            self._emit_browser_event({
                "type": "progress",
                "progress": 0,
                "message": "正在连接浏览器组件下载服务…",
            })
            command, environment = browser_install_command()
            environment["PLAYWRIGHT_BROWSERS_PATH"] = str(self.paths.browser_dir)
            creation_flags = 0
            if sys.platform == "win32":
                creation_flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                env=environment,
                creationflags=creation_flags,
                start_new_session=sys.platform != "win32",
            )
            with self.browser_lock:
                self.browser_install_process = process
                cancelled_before_start = self.browser_install_cancelled
            if cancelled_before_start:
                self._terminate_process_tree(process)
            assert process.stdout is not None
            for raw_line in process.stdout:
                line = raw_line.strip()
                if not line:
                    continue
                if line.startswith("Downloading Chromium"):
                    phase = "browser"
                    message = "正在下载备用 Chromium…"
                elif line.startswith("Downloading FFMPEG"):
                    phase = "tools"
                    progress = max(progress, 94)
                    message = "正在准备浏览器运行组件…"
                elif line.startswith("Downloading Winldd"):
                    phase = "tools"
                    progress = max(progress, 97)
                    message = "正在完成组件安装…"
                else:
                    message = "正在下载并安装浏览器组件…"
                match = re.search(r"(\d+)% of [\d.]+ MiB", line)
                if match:
                    percent = max(0, min(int(match.group(1)), 100))
                    if phase == "browser":
                        progress = max(progress, min(93, round(percent * 0.93)))
                    else:
                        progress = max(progress, min(99, 94 + round(percent * 0.05)))
                    self._emit_browser_event({
                        "type": "progress",
                        "progress": progress,
                        "message": message,
                    })
                elif "Error" in line or "failed" in line.lower():
                    diagnostics.append(re.sub(r"https?://\S+", "下载地址", line))
            exit_code = process.wait()
            with self.browser_lock:
                cancelled = self.browser_install_cancelled
            if cancelled:
                self._emit_browser_event({
                    "type": "cancelled",
                    "message": "浏览器组件下载已取消。",
                    "status": browser_component_status(self.paths),
                })
                return
            status = browser_component_status(self.paths)
            if exit_code == 0 and status["installed"]:
                self._emit_browser_event({
                    "type": "success",
                    "progress": 100,
                    "message": "浏览器组件安装完成，正在继续任务…",
                    "status": status,
                })
                self._send_worker_command("browser-ready")
                return
            detail = diagnostics[-1] if diagnostics else f"安装程序退出码 {exit_code}"
            self._emit_browser_event({
                "type": "error",
                "message": f"浏览器组件下载失败，请检查网络后重试。{detail}",
                "status": browser_component_status(self.paths),
            })
        except Exception as exc:
            self._emit_browser_event({
                "type": "error",
                "message": f"无法安装浏览器组件：{str(exc).splitlines()[0]}",
                "status": browser_component_status(self.paths),
            })
        finally:
            with self.browser_lock:
                self.browser_install_process = None
                self.browser_installing = False
                self.browser_install_cancelled = False

    @staticmethod
    def _clear_directory(path: Path) -> None:
        path.mkdir(parents=True, exist_ok=True)
        for child in path.iterdir():
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
            else:
                child.unlink(missing_ok=True)

    def start_grade_export(self, params: dict[str, Any]) -> dict[str, str]:
        with self.lock:
            if self.worker is not None and self.worker.poll() is None:
                raise RuntimeError("已有导出任务正在运行")
            academic_year = validate_academic_year(str(params.get("academicYear", "")))
            semester = str(params.get("semester", ""))
            if semester not in SEMESTERS.values():
                raise ValueError("请选择有效学期")
            output_dir = Path(str(params.get("outputDir", ""))).expanduser()
            if not output_dir.is_dir():
                raise ValueError("保存目录不存在")
            summary = f"{academic_year}-{int(academic_year) + 1} 学年，第 {next(k for k, v in SEMESTERS.items() if v == semester)} 学期"
            task_id = self.tasks.create(MANIFEST.id, MANIFEST.name, MANIFEST.version, summary)
            self.settings.default_output_dir = str(output_dir)
            self.settings_store.save(self.settings)
            command = self._worker_command() + [
                "--worker", "grade-export", "--year", academic_year,
                "--semester", semester, "--output", str(output_dir),
                "--browser", self.settings.preferred_browser,
                "--keep-login", "yes" if self.settings.keep_login_state else "no",
            ]
            self.worker = subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )
            self.worker_task_id = task_id
            threading.Thread(target=self._read_worker, args=(self.worker, task_id), daemon=True).start()
            return {"taskId": task_id}

    @staticmethod
    def _worker_command() -> list[str]:
        if getattr(sys, "frozen", False) or "__compiled__" in globals():
            return [sys.executable]
        return [sys.executable, str(Path(__file__).resolve().parents[1] / "main.py")]

    def grade_command(self, params: dict[str, Any]) -> bool:
        command = str(params.get("command", ""))
        if command not in {"continue", "cancel", "browser-ready"}:
            raise ValueError("不支持的任务命令")
        return self._send_worker_command(command)

    def _send_worker_command(self, command: str) -> bool:
        worker = self.worker
        if worker is None or worker.poll() is not None or worker.stdin is None:
            return False
        worker.stdin.write(json.dumps({"command": command}, ensure_ascii=False) + "\n")
        worker.stdin.flush()
        if command == "cancel":
            threading.Timer(7, self._force_stop, args=(worker,)).start()
        return True

    @staticmethod
    def _force_stop(worker: subprocess.Popen[str]) -> None:
        if worker.poll() is None:
            worker.kill()

    def _read_worker(self, worker: subprocess.Popen[str], task_id: str) -> None:
        terminal = False
        assert worker.stdout is not None
        for line in worker.stdout:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            kind = event.get("type")
            if kind == "success":
                self.tasks.complete(task_id, str(event.get("path", "")))
                terminal = True
            elif kind == "error":
                self.tasks.fail(task_id, str(event.get("message", "导出失败")))
                terminal = True
            elif kind == "cancelled":
                self.tasks.cancel(task_id)
                terminal = True
            self.emit({"channel": "event", "name": "gradeExport", "taskId": task_id, "event": event})
        exit_code = worker.wait()
        if not terminal:
            stderr = worker.stderr.read().strip() if worker.stderr else ""
            message = stderr or f"后台任务异常结束（退出码 {exit_code}）"
            self.tasks.fail(task_id, message)
            self.emit({
                "channel": "event", "name": "gradeExport", "taskId": task_id,
                "event": {"type": "error", "code": "WORKER_EXIT", "message": message},
            })
        with self.lock:
            if self.worker is worker:
                self.worker = None
                self.worker_task_id = None


def bridge_main() -> int:
    bridge = Bridge()
    try:
        for line in sys.stdin:
            try:
                request = json.loads(line)
                request_id = str(request.get("id", ""))
                if not request_id:
                    continue
                bridge.respond(request_id, bridge.handle(request))
            except Exception as exc:
                bridge.respond(locals().get("request_id", "unknown"), error=str(exc))
    finally:
        if bridge.worker is not None and bridge.worker.poll() is None:
            bridge.worker.kill()
        bridge.cancel_browser_install({})
    return 0
