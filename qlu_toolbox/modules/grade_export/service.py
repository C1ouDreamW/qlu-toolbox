from __future__ import annotations

import base64
import shutil
import tempfile
import threading
import time
from pathlib import Path
from typing import Callable

from qlu_toolbox.core.browser_component import (
    DOWNLOAD_SIZE_MIB,
    INSTALLED_SIZE_MIB,
    configure_browser_environment,
)
from qlu_toolbox.core.paths import AppPaths

from .domain import (
    BASE_URL,
    EXPORT_URL,
    SCORE_URL,
    CancelledError,
    ExportError,
    ExportOptions,
    atomic_save,
    build_export_body,
    is_logged_in_url,
    output_path,
    semester_label,
    workbook_extension,
    xlsx_semester_values,
)


LOGIN_TIMEOUT_SECONDS = 15 * 60
EventSink = Callable[[dict[str, object]], None]


STAGES = {
    "environment": "检查运行环境",
    "browser": "启动浏览器",
    "login": "等待用户登录",
    "query": "查询成绩",
    "validate": "生成并校验文件",
    "save": "保存结果",
}


def _event(emit: EventSink, kind: str, **payload: object) -> None:
    emit({"type": kind, **payload})


def _check_cancelled(cancel_event: threading.Event) -> None:
    if cancel_event.is_set():
        raise CancelledError("操作已取消")


def _browser_candidates(preference: str) -> tuple[tuple[str | None, str], ...]:
    candidates = {
        "edge": ("msedge", "Microsoft Edge"),
        "chrome": ("chrome", "Google Chrome"),
        "chromium": (None, "备用 Chromium"),
    }
    order = ["edge", "chrome", "chromium"]
    if preference in candidates:
        order.remove(preference)
        order.insert(0, preference)
    return tuple(candidates[item] for item in order)


def _launch_context(
    playwright,
    playwright_error,
    options: ExportOptions,
    emit: EventSink,
    cancel_event: threading.Event,
    browser_ready_event: threading.Event,
):
    paths = AppPaths.discover()
    paths.ensure()
    transient_root: Path | None = None
    if options.keep_login_state:
        profile_root = paths.profile_dir / "grade-export"
        profile_root.mkdir(parents=True, exist_ok=True)
    else:
        transient_root = Path(tempfile.mkdtemp(prefix="grade-export-", dir=paths.data_dir))
        profile_root = transient_root

    managed_browser_installed = Path(playwright.chromium.executable_path).is_file()
    failures: list[str] = []
    for channel, label in _browser_candidates(options.preferred_browser):
        profile_dir = profile_root / f"browser-{channel or 'chromium'}"
        try:
            kwargs: dict[str, object] = {
                "user_data_dir": str(profile_dir),
                "headless": False,
                "accept_downloads": True,
                "no_viewport": True,
            }
            if channel:
                kwargs["channel"] = channel
            context = playwright.chromium.launch_persistent_context(**kwargs)
            _event(emit, "log", message=f"已启动 {label}")
            return context, transient_root
        except playwright_error as exc:
            failures.append(f"{label}: {str(exc).splitlines()[0]}")
            _event(emit, "log", message=f"{label} 不可用，正在尝试其他浏览器")

    if not managed_browser_installed:
        _event(
            emit,
            "browser_required",
            stage="browser",
            message="未找到可用的 Edge 或 Chrome，需要下载备用浏览器组件。",
            downloadSizeMiB=DOWNLOAD_SIZE_MIB,
            installedSizeMiB=INSTALLED_SIZE_MIB,
        )
        while not browser_ready_event.wait(0.25):
            _check_cancelled(cancel_event)
        browser_ready_event.clear()
        _check_cancelled(cancel_event)
        _event(emit, "status", stage="browser", message="浏览器组件已就绪，正在继续任务…")
        profile_dir = profile_root / "browser-chromium"
        try:
            context = playwright.chromium.launch_persistent_context(
                user_data_dir=str(profile_dir),
                headless=False,
                accept_downloads=True,
                no_viewport=True,
            )
            _event(emit, "log", message="已启动备用 Chromium")
            return context, transient_root
        except playwright_error as exc:
            failures.append(f"备用 Chromium: {str(exc).splitlines()[0]}")

    if transient_root:
        shutil.rmtree(transient_root, ignore_errors=True)
    detail = "；".join(failures)
    raise ExportError(f"没有可用浏览器。请安装或启用 Edge、Chrome，或下载备用 Chromium。{detail}")


def _wait_for_login(
    context,
    emit: EventSink,
    cancel_event: threading.Event,
    manual_continue_event: threading.Event,
):
    deadline = time.monotonic() + LOGIN_TIMEOUT_SECONDS
    seen_urls: set[str] = set()
    while time.monotonic() < deadline:
        _check_cancelled(cancel_event)
        pages = list(context.pages)
        detected_page = None
        for candidate in pages:
            try:
                page_state = candidate.evaluate(
                    """
                    () => ({
                        url: window.location.href,
                        loggedInDom: Boolean(
                            document.querySelector('#sessionUser')
                            || document.querySelector('#sessionUserKey')
                            || document.querySelector('a[href*="logout"]')
                        ),
                    })
                    """
                )
                url = page_state.get("url", "")
                logged_in_dom = bool(page_state.get("loggedInDom"))
            except Exception:
                url = candidate.url or ""
                logged_in_dom = False
            if url and url not in seen_urls and url != "about:blank":
                seen_urls.add(url)
                _event(emit, "log", message=f"浏览器页面：{url}")
            if is_logged_in_url(url) or (
                logged_in_dom and url.startswith("https://jw.qlu.edu.cn/jwglxt/")
            ):
                detected_page = candidate
                break

        if detected_page:
            _event(emit, "log", message="已自动识别登录成功")
            return detected_page

        if manual_continue_event.is_set():
            manual_continue_event.clear()
            page = None
            for candidate in reversed(pages):
                try:
                    current_url = candidate.evaluate("() => window.location.href")
                except Exception:
                    current_url = candidate.url or ""
                if is_logged_in_url(current_url):
                    page = candidate
                    break
            if page:
                _event(emit, "log", message="已验证当前页面登录状态")
                return page
            _event(
                emit,
                "status",
                stage="login",
                message="尚未检测到登录成功，请在工具箱打开的浏览器中完成登录。",
            )
        time.sleep(0.5)
    raise ExportError("等待登录超时，请重新开始任务")


def _friendly_error(exc: Exception) -> tuple[str, str]:
    text = str(exc).strip()
    if "net::ERR" in text:
        return "NETWORK_UNAVAILABLE", "无法访问学校教务系统，请检查网络、校园 VPN 或服务器状态。"
    if "Target page, context or browser has been closed" in text:
        return "BROWSER_CLOSED", "浏览器已被关闭，导出未完成。"
    if "Executable doesn't exist" in text:
        return "BROWSER_MISSING", "没有找到兼容浏览器，请安装 Edge、Chrome 或运行浏览器组件安装。"
    if isinstance(exc, PermissionError):
        return "OUTPUT_NOT_WRITABLE", "保存目录不可写，请选择其他文件夹。"
    if isinstance(exc, (FileExistsError, NotADirectoryError)):
        return "OUTPUT_INVALID", "所选保存位置不是有效文件夹，请重新选择。"
    if isinstance(exc, OSError):
        return "OUTPUT_ERROR", "无法使用所选保存位置，请检查磁盘空间或更换文件夹。"
    return "EXPORT_FAILED", text or exc.__class__.__name__


def run_export(
    options: ExportOptions,
    emit: EventSink,
    cancel_event: threading.Event,
    manual_continue_event: threading.Event,
    browser_ready_event: threading.Event,
) -> int:
    context = None
    transient_root: Path | None = None
    try:
        _event(emit, "status", stage="environment", message="正在检查运行环境…")
        options.output_dir.mkdir(parents=True, exist_ok=True)
        probe = options.output_dir / ".qlu-toolbox-write-test"
        probe.write_bytes(b"")
        probe.unlink()
        _check_cancelled(cancel_event)

        configure_browser_environment(AppPaths.discover())
        try:
            from playwright.sync_api import Error as PlaywrightError
            from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise ExportError("缺少 Playwright 运行组件，请重新安装 QLU 工具箱。") from exc

        _event(emit, "status", stage="browser", message="正在启动浏览器…")
        with sync_playwright() as playwright:
            context, transient_root = _launch_context(
                playwright,
                PlaywrightError,
                options,
                emit,
                cancel_event,
                browser_ready_event,
            )
            page = context.pages[0] if context.pages else context.new_page()
            try:
                page.goto(BASE_URL, wait_until="domcontentloaded", timeout=60_000)
            except PlaywrightTimeoutError:
                _event(emit, "log", message="教务系统加载较慢，请继续在浏览器中操作")

            _event(
                emit,
                "status",
                stage="login",
                message="请在浏览器中手动登录，成功后程序会自动继续。",
            )
            login_page = _wait_for_login(
                context, emit, cancel_event, manual_continue_event
            )
            _check_cancelled(cancel_event)

            _event(emit, "status", stage="query", message="正在打开学生成绩查询…")
            login_page.goto(SCORE_URL, wait_until="domcontentloaded", timeout=60_000)
            login_page.wait_for_selector("#xnm", state="attached", timeout=30_000)
            login_page.wait_for_selector("#xqm", state="attached", timeout=30_000)
            login_page.wait_for_function(
                """
                () => {
                    const year = document.getElementById('xnm');
                    const semester = document.getElementById('xqm');
                    return year && semester
                        && year.options.length > 1 && semester.options.length > 1;
                }
                """,
                timeout=30_000,
            )

            selection = login_page.evaluate(
                """
                ({academicYear, semester}) => {
                    const yearSelect = document.getElementById('xnm');
                    const semesterSelect = document.getElementById('xqm');
                    if (!yearSelect || !semesterSelect) {
                        return {ok: false, message: '成绩页面缺少学年或学期控件'};
                    }
                    const schoolYear = `${academicYear}-${Number(academicYear) + 1}`;
                    const yearOption = Array.from(yearSelect.options).find(option =>
                        option.value === academicYear
                        || (option.textContent || '').includes(schoolYear)
                    );
                    const semesterNames = {'3': ['1', '第一'], '12': ['2', '第二']};
                    const semesterOption = Array.from(semesterSelect.options).find(option => {
                        if (option.value === semester) return true;
                        const text = (option.textContent || '').trim();
                        return (semesterNames[semester] || []).some(name => text.includes(name));
                    });
                    if (!yearOption) return {ok: false, message: `成绩页面中没有 ${schoolYear} 学年`};
                    if (!semesterOption) return {ok: false, message: '成绩页面中没有所选学期'};
                    yearSelect.value = yearOption.value;
                    semesterSelect.value = semesterOption.value;
                    yearSelect.dispatchEvent(new Event('change', {bubbles: true}));
                    semesterSelect.dispatchEvent(new Event('change', {bubbles: true}));
                    return {
                        ok: true,
                        academicYearValue: yearOption.value,
                        semesterValue: semesterOption.value,
                    };
                }
                """,
                {"academicYear": options.academic_year, "semester": options.semester_value},
            )
            if not selection.get("ok"):
                raise ExportError(selection.get("message", "无法设置学年和学期"))
            export_year = selection["academicYearValue"]
            export_semester = selection["semesterValue"]
            _event(emit, "log", message="已设置学年和学期")

            query_started = login_page.evaluate(
                """
                () => {
                    const button = document.getElementById('search_go');
                    if (!button) return false;
                    button.click();
                    return true;
                }
                """
            )
            if not query_started:
                raise ExportError("成绩页面缺少查询按钮，教务系统页面可能已更新")
            login_page.wait_for_timeout(800)
            try:
                login_page.wait_for_function(
                    "() => !window.jQuery || window.jQuery.active === 0", timeout=15_000
                )
            except PlaywrightTimeoutError:
                _event(emit, "log", message="成绩查询响应较慢，将继续尝试导出")
            _check_cancelled(cancel_event)

            _event(emit, "status", stage="validate", message="正在生成并校验分项成绩文件…")
            desired_semester = semester_label(options.semester_value)
            candidate_values = list(
                dict.fromkeys((export_semester, options.semester_value, desired_semester))
            )
            content = b""
            extension = ""
            actual_semesters: set[str] = set()
            for candidate in candidate_values:
                _check_cancelled(cancel_event)
                body = build_export_body(export_year, candidate)
                export_result = login_page.evaluate(
                    """
                    async ({url, body}) => {
                        const response = await fetch(url, {
                            method: 'POST',
                            headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'},
                            body,
                        });
                        const bytes = new Uint8Array(await response.arrayBuffer());
                        let binary = '';
                        const chunkSize = 0x8000;
                        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
                            binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
                        }
                        return {
                            ok: response.ok,
                            status: response.status,
                            contentType: response.headers.get('content-type') || '',
                            base64: btoa(binary),
                        };
                    }
                    """,
                    {"url": EXPORT_URL, "body": body},
                )
                if not export_result["ok"]:
                    raise ExportError(f"教务系统导出失败（HTTP {export_result['status']}）")
                candidate_content = base64.b64decode(export_result["base64"])
                candidate_extension = workbook_extension(
                    candidate_content, export_result.get("contentType", "")
                )
                if candidate_extension != ".xlsx":
                    content, extension = candidate_content, candidate_extension
                    break
                actual_semesters = xlsx_semester_values(candidate_content)
                _event(
                    emit,
                    "log",
                    message=f"服务器返回学期：{', '.join(sorted(actual_semesters)) or '未知'}",
                )
                if desired_semester in actual_semesters:
                    content, extension = candidate_content, candidate_extension
                    break

            if not content:
                actual = ", ".join(sorted(actual_semesters)) or "未知"
                raise ExportError(
                    f"服务器返回的是第 {actual} 学期，与所选第 {desired_semester} 学期不一致，已拒绝保存"
                )

            _event(emit, "status", stage="save", message="正在保存 Excel 文件…")
            destination = output_path(options, extension)
            atomic_save(destination, content)
            _event(emit, "success", path=str(destination))
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
