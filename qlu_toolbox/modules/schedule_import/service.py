from __future__ import annotations

import base64
import json
import shutil
import tempfile
import threading
import time
from pathlib import Path
from typing import Callable, NamedTuple

from qlu_toolbox.core.browser_component import configure_browser_environment
from qlu_toolbox.core.paths import AppPaths
from qlu_toolbox.modules.grade_export.domain import BASE_URL as SCHOOL_BASE_URL
from qlu_toolbox.modules.grade_export.domain import workbook_extension
from qlu_toolbox.modules.grade_export.service import _launch_context, _wait_for_login
from qlu_toolbox.modules.schedule_io import parse_schedule_source

from .domain import (
    CAPTURE_TIMEOUT_SECONDS,
    DOM_SOURCE_EXTENSION,
    SCHEDULE_URL,
    CancelledError,
    ImportOptions,
    ScheduleImportError,
    build_interceptor_script,
    build_dom_capture_script,
    is_schedule_page,
    verified_capture,
)

LOGIN_TIMEOUT_SECONDS = 15 * 60
POLL_INTERVAL_SECONDS = 0.5
EventSink = Callable[[dict[str, object]], None]


class _LaunchOptions(NamedTuple):
    preferred_browser: str
    keep_login_state: bool


def _event(emit: EventSink, event_type: str, **payload: object) -> None:
    emit({"type": event_type, **payload})


def _check_cancelled(cancel_event: threading.Event) -> None:
    if cancel_event.is_set():
        raise CancelledError("操作已取消")


def _friendly_error(exc: Exception) -> tuple[str, str]:
    text = str(exc).strip()
    if "net::ERR" in text:
        return "NETWORK_UNAVAILABLE", "无法访问学校教务系统，请检查网络、校园 VPN 或服务器状态。"
    if "Target page, context or browser has been closed" in text:
        return "BROWSER_CLOSED", "浏览器已被关闭，课表导入未完成。"
    if "Executable doesn't exist" in text:
        return "BROWSER_MISSING", "没有找到兼容浏览器，请安装 Edge、Chrome 或运行浏览器组件安装。"
    return "IMPORT_FAILED", text or exc.__class__.__name__


def _wait_for_capture(
    page,
    work_root: Path,
    emit: EventSink,
    cancel_event: threading.Event,
) -> tuple[bytes, str]:
    """等待用户选择网页直读或学校“输出EXCEL”导出。

    双通道：向所有 frame 注入表单拦截脚本（覆盖导出表单在子 iframe 的情况），
    同时监听浏览器下载事件作为兜底（覆盖按钮走原生提交、拦截脚本无法劫持的
    情况——这类提交会被 Playwright 静默保存后丢弃）。返回 (内容, 扩展名)，
    下载兜底路径扩展名为空，由调用方按魔数识别。
    """
    deadline = time.monotonic() + CAPTURE_TIMEOUT_SECONDS
    reminder_deadline = time.monotonic() + 30
    script = build_interceptor_script()
    dom_script = build_dom_capture_script()
    downloaded: list[Path] = []

    def on_download(download) -> None:
        try:
            target = work_root / "教务课表-网页下载"
            download.save_as(str(target))
            downloaded.append(target)
        except Exception:
            pass

    context = page.context
    try:
        context.add_init_script(script)
    except Exception:
        pass
    context.on("download", on_download)
    last_click = ""
    last_dom_error = ""
    try:
        while time.monotonic() < deadline:
            _check_cancelled(cancel_event)
            if downloaded:
                _event(emit, "status", stage="validate", message="已捕获浏览器下载的课表文件，正在校验…")
                return downloaded[0].read_bytes(), ""
            try:
                dom_state = json.loads(page.evaluate(dom_script) or "null")
                if isinstance(dom_state, dict) and isinstance(dom_state.get("result"), dict):
                    _event(emit, "status", stage="validate", message="已读取网页课表，正在校验…")
                    return json.dumps(dom_state["result"], ensure_ascii=False).encode("utf-8"), DOM_SOURCE_EXTENSION
                dom_error = str(dom_state.get("error") or "") if isinstance(dom_state, dict) and dom_state.get("requested") else ""
                if dom_error and dom_error != last_dom_error:
                    last_dom_error = dom_error
                    _event(emit, "log", message=f"网页课表读取失败：{dom_error}；仍可点击“输出EXCEL”回退。")
            except Exception:
                pass
            for frame in page.frames:
                try:
                    state = frame.evaluate(script)
                except Exception:
                    continue
                click = str((state or {}).get("lastClick") or "")
                if click and click != last_click:
                    last_click = click
                    _event(emit, "log", message=f"已检测到页面点击「{click}」，正在等待导出响应…")
                result = (state or {}).get("result")
                if isinstance(result, str):
                    try:
                        result = json.loads(result)
                    except json.JSONDecodeError:
                        result = None
                if isinstance(result, dict):
                    if not result.get("ok"):
                        raise ScheduleImportError(str(result.get("message") or "教务系统没有返回课表文件"))
                    _event(emit, "status", stage="validate", message="正在校验并解析课表文件…")
                    payload = frame.evaluate("() => window.__LUMATILE_SCHEDULE_IMPORT__.base64 || ''")
                    content = base64.b64decode(payload or "")
                    return content, verified_capture(result, content)
            if time.monotonic() > reminder_deadline:
                reminder_deadline = time.monotonic() + 60
                _event(
                    emit,
                    "status",
                    stage="capture",
                    message="请查询课表并点击页面右下角的“一格有光”导入按钮；也可点击“输出EXCEL”回退。",
                )
            time.sleep(POLL_INTERVAL_SECONDS)
    finally:
        try:
            context.remove_listener("download", on_download)
        except Exception:
            pass
    raise ScheduleImportError("等待导出超时，请重新开始导入")


def run_import(
    options: ImportOptions,
    emit: EventSink,
    cancel_event: threading.Event,
    manual_continue_event: threading.Event,
    browser_ready_event: threading.Event,
) -> int:
    context = None
    transient_root: Path | None = None
    work_root: Path | None = None
    try:
        _event(emit, "status", stage="environment", message="正在检查运行环境…")
        paths = AppPaths.discover()
        paths.ensure()
        work_root = Path(tempfile.mkdtemp(prefix="schedule-import-", dir=paths.data_dir))
        _check_cancelled(cancel_event)

        configure_browser_environment(paths)
        try:
            from playwright.sync_api import Error as PlaywrightError
            from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise ScheduleImportError("缺少 Playwright 运行组件，请重新安装一格有光。") from exc

        _event(emit, "status", stage="browser", message="正在启动浏览器…")
        launch_options = _LaunchOptions(
            preferred_browser=options.preferred_browser,
            keep_login_state=options.keep_login_state,
        )
        with sync_playwright() as playwright:
            context, transient_root = _launch_context(
                playwright,
                PlaywrightError,
                launch_options,
                emit,
                cancel_event,
                browser_ready_event,
            )
            page = context.pages[0] if context.pages else context.new_page()
            try:
                page.goto(SCHOOL_BASE_URL, wait_until="domcontentloaded", timeout=60_000)
            except PlaywrightTimeoutError:
                _event(emit, "log", message="教务系统加载较慢，请继续在浏览器中操作")

            _event(
                emit,
                "status",
                stage="login",
                message="请在浏览器中手动登录，成功后程序会自动继续。",
            )
            login_page = _wait_for_login(context, emit, cancel_event, manual_continue_event)
            _check_cancelled(cancel_event)

            _event(emit, "status", stage="schedule", message="正在打开个人课表查询…")
            try:
                login_page.goto(SCHEDULE_URL, wait_until="domcontentloaded", timeout=60_000)
            except PlaywrightTimeoutError:
                _event(emit, "log", message="课表页面加载较慢，请继续在浏览器中操作")
            _check_cancelled(cancel_event)

            if not is_schedule_page(login_page.url):
                _event(emit, "log", message="请回到教务系统课表查询页面完成导出")

            _event(
                emit,
                "status",
                stage="capture",
                message="请选择学年、学期并查询，然后点击页面右下角的“一格有光”导入按钮；也可点击“输出EXCEL”回退。",
            )
            content, extension = _wait_for_capture(login_page, work_root, emit, cancel_event)
            if extension == DOM_SOURCE_EXTENSION:
                try:
                    dom = json.loads(content.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise ScheduleImportError("网页课表数据格式无效") from exc
                _event(emit, "success", kind="qlu-dom", fileName="教务网页课表", dom=dom)
                return 0
            if not extension:
                try:
                    extension = workbook_extension(content)
                except RuntimeError as exc:
                    raise ScheduleImportError(str(exc)) from exc

            workbook_path = work_root / f"教务课表{extension}"
            workbook_path.write_bytes(content)
            source = parse_schedule_source(workbook_path)
            if source.get("kind") != "workbook":
                raise ScheduleImportError("导出的不是课表 Excel 文件")
            _event(emit, "success", kind="workbook", fileName="教务课表" + extension, rows=source.get("rows", []))
            return 0
    except CancelledError:
        _event(emit, "cancelled", message="操作已取消")
        return 2
    except Exception as exc:
        code, message = _friendly_error(exc)
        _event(emit, "error", code=code, message=message)
        return 1
    finally:
        if context is not None:
            try:
                context.close()
            except Exception:
                pass
        if transient_root is not None:
            shutil.rmtree(transient_root, ignore_errors=True)
        if work_root is not None:
            shutil.rmtree(work_root, ignore_errors=True)
