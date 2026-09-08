"""学分修读情况：Playwright 爬取层（培养方案修读要求 + 官方课程映射 + 全部成绩）。"""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from qlu_toolbox.core.paths import AppPaths

from .domain import (
    ENROLL_QUERY_URL,
    GRADE_QUERY_URL,
    GRADES_SNAPSHOT_NAME,
    PLAN_INDEX_URL,
    PLAN_NODE_COURSES_URL,
    PLAN_SNAPSHOT_NAME,
    PLAN_XDYQ_URL,
    SNAPSHOT_DIR_NAME,
    CourseRecord,
    load_rules,
    parse_requirement_tree,
    plan_from_tree,
    rules_from_dict,
    summarize,
)
from qlu_toolbox.modules.grade_export.domain import BASE_URL, SCORE_URL, ExportError, CancelledError
from qlu_toolbox.modules.grade_export.service import _launch_context, _wait_for_login


YEARS_TO_QUERY = 8
EventSink = Any


@dataclass(frozen=True)
class CreditOptions:
    preferred_browser: str = "auto"
    keep_login_state: bool = True


def _event(emit: EventSink, kind: str, **payload: object) -> None:
    emit({"type": kind, **payload})


def _check_cancelled(cancel_event: threading.Event) -> None:
    if cancel_event.is_set():
        raise CancelledError("操作已取消")


def _friendly_error(exc: Exception) -> tuple[str, str]:
    text = str(exc).strip()
    if "net::ERR" in text:
        return "NETWORK_UNAVAILABLE", "无法访问学校教务系统，请检查网络、校园 VPN 或服务器状态。"
    if "Target page, context or browser has been closed" in text:
        return "BROWSER_CLOSED", "浏览器已被关闭，统计未完成。"
    if "Executable doesn't exist" in text:
        return "BROWSER_MISSING", "没有找到兼容浏览器，请安装 Edge、Chrome 或运行浏览器组件安装。"
    return "CREDIT_REPORT_FAILED", text or exc.__class__.__name__


def _fetch_in_page(page, url: str, body: str | None = None) -> str:
    """在页面上下文里发请求（继承登录会话），返回响应文本。"""
    return page.evaluate(
        """
        async ({url, body}) => {
            const response = await fetch(url, body ? {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                body,
            } : {method: 'GET', headers: {'X-Requested-With': 'XMLHttpRequest'}});
            const text = await response.text();
            if (!response.ok) {
                throw new Error('HTTP ' + response.status + '：' + text.slice(0, 120));
            }
            return text;
        }
        """,
        {"url": url, "body": body},
    )


def _capture_plan(page, emit: EventSink, cancel_event: threading.Event) -> dict[str, Any] | None:
    """读取培养方案：列表页拿 jxzxjhxx_id → 修读要求页解析要求树 → 每个节点拉官方课程清单。"""
    captured: dict[str, Any] | None = None

    def on_response(response) -> None:
        nonlocal captured
        try:
            url = response.url
        except Exception:
            return
        if "jxzxjhck_cxJxzxjhckIndex" not in url or "doType=query" not in url:
            return
        try:
            data = response.json()
        except Exception:
            return
        items = data.get("items") if isinstance(data, dict) else None
        if items and not captured:
            captured = {"items": items}

    page.on("response", on_response)
    try:
        page.goto(PLAN_INDEX_URL, wait_until="domcontentloaded", timeout=60_000)
        # 教务页面加载慢时列表 XHR 可能晚到，多等两轮再放弃。
        for _ in range(3):
            if captured:
                break
            page.wait_for_timeout(3_500)
        _check_cancelled(cancel_event)

        items = (captured or {}).get("items") or []
        if not items:
            _event(emit, "log", message="培养方案列表没有加载数据，将使用内置要求模板")
            return None
        row = items[0]
        plan_id = str(row.get("jxzxjhxx_id") or "")
        if not plan_id:
            _event(emit, "log", message="培养方案列表缺少计划 ID，将使用内置要求模板")
            return None
        _event(
            emit,
            "log",
            message=f"培养方案：{row.get('zymc', '?')} {row.get('njmc', '?')} 级（总学分 {row.get('zdxf', '?')}）",
        )

        html = _fetch_in_page(
            page, f"{PLAN_XDYQ_URL}?jxzxjhxx_id={plan_id}&gnmkdm=N153540&layout=default"
        )
        _check_cancelled(cancel_event)
        tree = parse_requirement_tree(html)
        plan = plan_from_tree(tree)
        if plan is None:
            _event(emit, "log", message="修读要求页里没有找到综合素质选修课节点，将使用内置要求模板")
            return {"items": items, "html": html, "plan": None, "course_map": {}}
        _event(
            emit,
            "log",
            message=(
                f"修读要求：{plan['plan_name']} 共 {plan['total_required']:g} 学分，"
                f"模块 {len(plan['modules'])} 个"
            ),
        )

        course_map: dict[str, list[dict[str, Any]]] = {}
        node_jdkcsx = plan.get("node_jdkcsx") or {}
        for key, node_id in plan.get("node_ids", {}).items():
            _check_cancelled(cancel_event)
            jdkcsx = node_jdkcsx.get(key, "1") or "1"
            body = f"xfyqjd_id={node_id}&jdkcsx={jdkcsx}"
            text = ""
            try:
                text = _fetch_in_page(page, PLAN_NODE_COURSES_URL, body)
                data = json.loads(text.lstrip("﻿\r\n\t "))
            except Exception as exc:
                head = " ".join(text[:100].split()) if text else "<无响应>"
                _event(
                    emit,
                    "log",
                    message=f"官方课程映射 {key} 读取失败（{exc}）：{head}",
                )
                course_map[key] = []
                continue
            courses = []
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict):
                        courses.append({
                            "code": str(item.get("KCH") or "").strip(),
                            "name": str(item.get("KCMC") or "").strip(),
                            "credit": item.get("XF"),
                        })
            course_map[key] = courses
            _event(emit, "log", message=f"官方课程映射 {key}：{len(courses)} 门")
        plan["course_map"] = course_map
        return {"items": items, "html": html, "plan": plan, "course_map": course_map}
    finally:
        try:
            page.remove_listener("response", on_response)
        except Exception:
            pass


def _fetch_all_grades(page, emit: EventSink, cancel_event: threading.Event) -> list[dict[str, Any]]:
    """枚举最近学年的每个学期，调用学生成绩接口并聚合。"""
    page.goto(SCORE_URL, wait_until="domcontentloaded", timeout=60_000)
    page.wait_for_selector("#xnm", state="attached", timeout=30_000)
    page.wait_for_selector("#xqm", state="attached", timeout=30_000)
    page.wait_for_function(
        """
        () => {
            const year = document.getElementById('xnm');
            const semester = document.getElementById('xqm');
            return year && semester && year.options.length > 1 && semester.options.length > 1;
        }
        """,
        timeout=30_000,
    )
    options = page.evaluate(
        """
        () => ({
            years: Array.from(document.getElementById('xnm').options)
                .map(option => option.value).filter(Boolean),
            semesters: Array.from(document.getElementById('xqm').options)
                .map(option => option.value).filter(Boolean),
        })
        """
    )
    years = sorted(
        (value for value in options.get("years") or [] if value.isdigit()),
        key=int,
        reverse=True,
    )[:YEARS_TO_QUERY]
    semesters = [value for value in options.get("semesters") or [] if value]
    if not years or not semesters:
        raise ExportError("成绩页面缺少学年或学期数据，教务系统可能已更新")
    _event(emit, "log", message=f"查询最近 {len(years)} 个学年 × {len(semesters)} 个学期")

    items: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    first_fields_logged = False
    failures: list[str] = []
    for year in years:
        for semester in semesters:
            _check_cancelled(cancel_event)
            # 与页面自己的请求保持一致：sortName 的 + 不能编码成 %2B，否则服务端返回空。
            body = (
                f"xnm={year}&xqm={semester}&sfzgcj=&kcbj=&pkey=&_search=false"
                f"&nd={int(time.time() * 1000)}&queryModel.showCount=1000"
                "&queryModel.currentPage=1&queryModel.sortName=+&queryModel.sortOrder=asc&time=0"
            )
            try:
                text = _fetch_in_page(page, GRADE_QUERY_URL, body)
            except ExportError:
                raise
            except Exception as exc:
                detail = " ".join(str(exc)[:150].split())
                failures.append(f"{year}/{semester}: {detail}")
                _event(emit, "log", message=f"成绩接口请求异常（{year} 学年）：{detail}")
                continue
            cleaned = text.lstrip("﻿\r\n\t ")
            try:
                data = json.loads(cleaned)
            except json.JSONDecodeError:
                head = " ".join(cleaned[:100].split()) or "<空响应>"
                detail = f"{head}（长度 {len(cleaned)}）"
                failures.append(f"{year}/{semester}: {detail}")
                _event(emit, "log", message=f"成绩接口返回异常（{year} 学年）：{detail}")
                continue
            batch = data.get("items") if isinstance(data, dict) else None
            if not isinstance(batch, list):
                continue
            fresh = []
            for item in batch:
                if not isinstance(item, dict):
                    continue
                if str(item.get("cjsfzf") or "").strip() == "是":
                    continue  # 成绩作废的记录不统计
                key = (
                    str(item.get("kch") or item.get("kcmc") or ""),
                    str(item.get("xnm") or year),
                    str(item.get("xqm") or semester),
                )
                if key in seen:
                    continue
                seen.add(key)
                fresh.append(item)
            if fresh and not first_fields_logged:
                first_fields_logged = True
                _event(emit, "log", message=f"成绩记录字段：{', '.join(sorted(fresh[0].keys()))}")
            if fresh:
                items.extend(fresh)
                _event(emit, "log", message=f"{year} 学年（学期 {semester}）：读取 {len(fresh)} 门课程")
    if not items and failures:
        raise ExportError(f"成绩接口没有返回可解析的数据（{failures[0]}）")

    # 选课名单：最新学年里选了但还没有成绩的课程 = 在修。
    in_progress = 0
    latest_year = years[0]
    for semester in semesters:
        _check_cancelled(cancel_event)
        body = (
            f"xnm={latest_year}&xqm={semester}&kkxy_id=&kclbdm=&kcxzmc=&kch=&kklxdm=&kkzt=1"
            "&jxbmc=&jsxx=&kcgsdm=&xdbj=&fxbj=&cxbj=&zxbj=&sfzbh_kcflsj=&cxlx=&zyfx_id="
            "&xklc=&xkly=&_search=false"
            f"&nd={int(time.time() * 1000)}"
            "&queryModel.showCount=1000&queryModel.currentPage=1"
            "&queryModel.sortName=xkbjmc%2Cxnmc%2Cxqmc%2Ckkxymc%2Ckch%2Cjxbmc%2Cxh+"
            "&queryModel.sortOrder=asc&time=0"
        )
        try:
            text = _fetch_in_page(page, ENROLL_QUERY_URL, body)
            data = json.loads(text.lstrip("﻿\r\n\t "))
        except Exception:
            continue
        batch = data.get("items") if isinstance(data, dict) else None
        if not isinstance(batch, list):
            continue
        for item in batch:
            if not isinstance(item, dict):
                continue
            key = (
                str(item.get("kch") or ""),
                str(item.get("xnm") or latest_year),
                str(item.get("xqm") or semester),
            )
            if key in seen:
                continue
            seen.add(key)
            items.append({
                "kch": item.get("kch"),
                "kcmc": item.get("kcmc"),
                "xf": item.get("xf"),
                "cj": "",
                "kclbmc": item.get("kclbmc"),
                "kcxzmc": item.get("kcxzmc"),
                "xnm": item.get("xnm") or latest_year,
                "xqm": item.get("xqm") or semester,
            })
            in_progress += 1
    if in_progress:
        _event(emit, "log", message=f"选课名单：{in_progress} 门已选未出成绩的课程计入「在修」")
    return items


def run_credit_report(
    options: CreditOptions,
    emit: EventSink,
    cancel_event: threading.Event,
    manual_continue_event: threading.Event,
    browser_ready_event: threading.Event,
) -> int:
    context = None
    try:
        _event(emit, "status", stage="environment", message="正在检查运行环境…")
        configure_browser_environment()
        try:
            from playwright.sync_api import Error as PlaywrightError
            from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise ExportError("缺少 Playwright 运行组件，请重新安装一格有光。") from exc

        _event(emit, "status", stage="browser", message="正在启动浏览器…")
        with sync_playwright() as playwright:
            context, _ = _launch_context(
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
            _wait_for_login(context, emit, cancel_event, manual_continue_event)
            _check_cancelled(cancel_event)

            _event(emit, "status", stage="plan", message="正在读取培养方案修读要求…")
            plan_capture = _capture_plan(page, emit, cancel_event)

            _event(emit, "status", stage="grades", message="正在读取全部学期的成绩…")
            items = _fetch_all_grades(page, emit, cancel_event)
            if not items:
                raise ExportError("没有读取到任何成绩记录")

            _event(emit, "status", stage="analyze", message="正在统计学分修读情况…")
            paths = AppPaths.discover()
            snapshot_dir = paths.data_dir / SNAPSHOT_DIR_NAME
            snapshot_dir.mkdir(parents=True, exist_ok=True)
            _atomic_text(
                snapshot_dir / PLAN_SNAPSHOT_NAME,
                json.dumps(
                    {
                        "items": (plan_capture or {}).get("items", []),
                        "html": (plan_capture or {}).get("html", ""),
                        "plan": (plan_capture or {}).get("plan"),
                        "course_map": (plan_capture or {}).get("course_map", {}),
                    },
                    ensure_ascii=False,
                    indent=1,
                    default=str,
                ),
            )
            _atomic_text(
                snapshot_dir / GRADES_SNAPSHOT_NAME,
                json.dumps(items, ensure_ascii=False, indent=1, default=str),
            )

            rules = rules_from_dict(load_rules(paths))
            plan = (plan_capture or {}).get("plan")
            records = [CourseRecord.from_item(item) for item in items]
            report = summarize(records, rules, plan)
            report["snapshotDir"] = str(snapshot_dir)
            _event(emit, "success", report=report, path=str(snapshot_dir))
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


def configure_browser_environment() -> None:
    from qlu_toolbox.core.browser_component import configure_browser_environment as configure

    configure(AppPaths.discover())


def _atomic_text(destination: Path, text: str) -> None:
    temporary = destination.with_name(f".{destination.name}.part")
    try:
        temporary.write_text(text, encoding="utf-8")
        temporary.replace(destination)
    except OSError:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
