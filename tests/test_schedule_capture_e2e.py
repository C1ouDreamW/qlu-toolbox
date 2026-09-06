from __future__ import annotations

import http.server
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from qlu_toolbox.modules.schedule_import import service as capture_service

CONTENT = bytes.fromhex("D0CF11E0A1B11AE1") + b"mock-timetable-body"

EXPORT_FORM_HTML = """
<form id="dcform" action="/jwglxt/kbcx/xskbcx_cxDcExcelXskb.html" method="post">
  <input type="hidden" name="xnm" value="2026">
</form>
<button id="dc" onclick="document.getElementById('dcform').submit()">输出EXCEL</button>
<script>setTimeout(() => document.getElementById('dc').click(), 600)</script>
"""

NATIVE_SUBMIT_HTML = """
<form action="/jwglxt/kbcx/xskbcx_cxDcExcelXskb.html" method="post">
  <input type="hidden" name="xnm" value="2026">
  <button id="dc" type="submit">输出EXCEL</button>
</form>
<script>setTimeout(() => document.getElementById('dc').click(), 600)</script>
"""

AJAX_HTML = """
<button id="dc">输出EXCEL</button>
<script>
document.getElementById('dc').addEventListener('click', () => {
  fetch('/jwglxt/kbcx/xskbcx_cxDcExcelXskb.html', {
    method: 'POST',
    body: new URLSearchParams({xnm: '2026'}),
  });
});
</script>
<script>setTimeout(() => document.getElementById('dc').click(), 600)</script>
"""

IFRAME_OUTER_HTML = '<iframe src="/frame.html"></iframe>'

PAGES = {
    "/": EXPORT_FORM_HTML,
    "/frame.html": NATIVE_SUBMIT_HTML,
    "/native": NATIVE_SUBMIT_HTML,
    "/ajax": AJAX_HTML,
    "/iframe": IFRAME_OUTER_HTML,
}


class MockSchoolHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]
        body = PAGES.get(path, PAGES["/"]).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", "0") or 0))
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(CONTENT)

    def log_message(self, *args):
        pass


class EmitSink:
    def __init__(self):
        self.events = []

    def __call__(self, event):
        self.events.append(event)


class ScheduleCaptureEndToEndTests(unittest.TestCase):
    """用真实浏览器验证导出捕获链路；没有可用浏览器时跳过。"""

    def setUp(self):
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), MockSchoolHandler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.work_root = Path(tempfile.mkdtemp(prefix="schedule-capture-"))
        self.emit = EmitSink()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def capture(self, path: str):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            self.skipTest(f"缺少 Playwright：{exc}")
        with sync_playwright() as playwright:
            try:
                browser = playwright.chromium.launch(channel="msedge", headless=True)
            except Exception as exc:
                self.skipTest(f"本机没有可用的 Edge，跳过：{str(exc).splitlines()[0]}")
            try:
                page = browser.new_context(accept_downloads=True).new_page()
                page.goto(f"{self.base}{path}", wait_until="domcontentloaded")
                with patch.object(capture_service, "POLL_INTERVAL_SECONDS", 0.05), \
                        patch.object(capture_service, "CAPTURE_TIMEOUT_SECONDS", 8):
                    return capture_service._wait_for_capture(page, self.work_root, self.emit, threading.Event())
            finally:
                browser.close()


class ScheduleCaptureTests(ScheduleCaptureEndToEndTests):
    def test_catches_programmatic_form_submit(self):
        content, extension = self.capture("/")
        self.assertEqual(content, CONTENT)
        self.assertEqual(extension, ".xls")

    def test_catches_native_submit_button(self):
        content, extension = self.capture("/native")
        self.assertEqual(content, CONTENT)
        self.assertEqual(extension, ".xls")

    def test_catches_page_fetch_export(self):
        content, extension = self.capture("/ajax")
        self.assertEqual(content, CONTENT)
        self.assertEqual(extension, ".xls")

    def test_catches_export_inside_iframe(self):
        content, extension = self.capture("/iframe")
        self.assertEqual(content, CONTENT)
        self.assertEqual(extension, ".xls")


if __name__ == "__main__":
    unittest.main()
