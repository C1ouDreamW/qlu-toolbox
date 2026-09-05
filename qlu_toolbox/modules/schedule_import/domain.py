from __future__ import annotations

import hashlib
from dataclasses import dataclass
from urllib.parse import urlparse

from qlu_toolbox.modules.grade_export.domain import workbook_extension

BASE_URL = "https://jw.qlu.edu.cn/"
SCHEDULE_URL = (
    "https://jw.qlu.edu.cn/jwglxt/kbcx/"
    "xskbcx_cxXskbcxIndex.html?gnmkdm=N253508&layout=default"
)
EXPORT_FORM_PATH_MARKER = "/kbcx/xskbcx_cxDcExcelXskb.html"
MAX_EXPORT_BYTES = 20 * 1024 * 1024
CAPTURE_TIMEOUT_SECONDS = 15 * 60


class ScheduleImportError(RuntimeError):
    pass


class CancelledError(ScheduleImportError):
    pass


@dataclass(frozen=True)
class ImportOptions:
    preferred_browser: str = "auto"
    keep_login_state: bool = True


def is_schedule_page(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    return (
        parsed.scheme == "https"
        and parsed.hostname == "jw.qlu.edu.cn"
        and parsed.path.startswith("/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html")
    )


def is_export_action(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    return (
        parsed.scheme == "https"
        and parsed.hostname == "jw.qlu.edu.cn"
        and parsed.path.endswith(EXPORT_FORM_PATH_MARKER)
    )


def build_interceptor_script() -> str:
    """劫持学校“输出EXCEL”表单提交，在同源环境抓取 Excel 并计算 SHA-256。"""
    return """
    (() => {
      const existing = window.__LUMATILE_SCHEDULE_IMPORT__;
      if (existing?.installed) {
        return { installed: true, started: Boolean(existing.started), result: existing.result };
      }
      const state = window.__LUMATILE_SCHEDULE_IMPORT__ = { installed: true, started: false, result: null, base64: null };
      const originalSubmit = HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit = function () {
        const url = new URL(this.action || location.href, location.href);
        if (url.origin !== location.origin || !url.pathname.endsWith('%(marker)s')) return originalSubmit.call(this);
        if (state.started) return;
        state.started = true;
        (async () => {
          try {
            const response = await fetch(url.toString(), {
              method: 'POST',
              credentials: 'same-origin',
              body: new URLSearchParams(new FormData(this)),
            });
            if (!response.ok) return JSON.stringify({ ok: false, message: '教务系统导出失败（HTTP ' + response.status + '）' });
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (!bytes.length || bytes.length > %(maxBytes)d) return JSON.stringify({ ok: false, message: '导出文件为空或超过安全限制' });
            const digest = await crypto.subtle.digest('SHA-256', bytes.buffer);
            const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
            let binary = '';
            for (let offset = 0; offset < bytes.length; offset += 0x8000) {
              binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
            }
            state.base64 = btoa(binary);
            return JSON.stringify({ ok: true, total: bytes.length, sha256 });
          } catch (error) {
            return JSON.stringify({ ok: false, message: String(error?.message || error) });
          }
        })().then(result => { state.result = result; });
      };
      return { installed: true, started: false, result: null };
    })()
    """ % {"marker": EXPORT_FORM_PATH_MARKER, "maxBytes": MAX_EXPORT_BYTES}


def verified_capture(result: dict[str, object], content: bytes) -> str:
    """校验页内拦截结果与实际内容，返回扩展名。"""
    if not result.get("ok"):
        raise ScheduleImportError(str(result.get("message") or "教务系统没有返回课表文件"))
    if result.get("total") != len(content):
        raise ScheduleImportError("导出内容长度与页内统计不一致，已拒绝使用")
    if result.get("sha256") != hashlib.sha256(content).hexdigest():
        raise ScheduleImportError("导出内容校验值不一致，已拒绝使用")
    try:
        return workbook_extension(content)
    except RuntimeError as exc:
        raise ScheduleImportError(str(exc)) from exc
