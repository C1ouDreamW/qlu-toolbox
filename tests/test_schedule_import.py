from __future__ import annotations

import hashlib
import unittest

from qlu_toolbox.modules.schedule_import.domain import (
    EXPORT_FORM_PATH_MARKER,
    MAX_EXPORT_BYTES,
    ScheduleImportError,
    build_interceptor_script,
    is_export_action,
    is_schedule_page,
    verified_capture,
)

XLSX_MAGIC = b"PK\x03\x04-workbook"
XLS_MAGIC = bytes.fromhex("D0CF11E0A1B11AE1") + b"-workbook"


def capture_for(content: bytes, **overrides: object) -> dict[str, object]:
    result: dict[str, object] = {
        "ok": True,
        "total": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }
    result.update(overrides)
    return result


class ScheduleImportDomainTests(unittest.TestCase):
    def test_recognizes_only_the_school_schedule_page(self):
        self.assertTrue(is_schedule_page(
            "https://jw.qlu.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N253508&layout=default"
        ))
        self.assertTrue(is_schedule_page(
            "https://jw.qlu.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html"
        ))
        self.assertFalse(is_schedule_page(
            "https://jw.qlu.edu.cn/jwglxt/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005"
        ))
        self.assertFalse(is_schedule_page("https://sso.qlu.edu.cn/login"))
        self.assertFalse(is_schedule_page("http://jw.qlu.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html"))
        self.assertFalse(is_schedule_page("https://evil.example/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html"))

    def test_recognizes_the_school_export_action(self):
        self.assertTrue(is_export_action(
            f"https://jw.qlu.edu.cn/jwglxt/kbcx/xskbcx_cxDcExcelXskb.html?gnmkdm=N253508"
        ))
        self.assertFalse(is_export_action("https://jw.qlu.edu.cn/jwglxt/cjcx/cjcx_dcXsKccjList.html"))
        self.assertFalse(is_export_action("https://evil.example/kbcx/xskbcx_cxDcExcelXskb.html"))

    def test_interceptor_script_targets_only_the_export_form(self):
        script = build_interceptor_script()
        self.assertIn(EXPORT_FORM_PATH_MARKER, script)
        self.assertIn(str(MAX_EXPORT_BYTES), script)
        self.assertIn("crypto.subtle.digest('SHA-256'", script)
        self.assertIn("HTMLFormElement.prototype.submit", script)
        self.assertIn("credentials: 'same-origin'", script)

    def test_verified_capture_accepts_matching_content(self):
        self.assertEqual(verified_capture(capture_for(XLSX_MAGIC), XLSX_MAGIC), ".xlsx")
        self.assertEqual(verified_capture(capture_for(XLS_MAGIC), XLS_MAGIC), ".xls")

    def test_verified_capture_rejects_failed_result(self):
        with self.assertRaises(ScheduleImportError):
            verified_capture({"ok": False, "message": "HTTP 500"}, XLSX_MAGIC)

    def test_verified_capture_rejects_length_mismatch(self):
        with self.assertRaises(ScheduleImportError):
            verified_capture(capture_for(XLSX_MAGIC, total=len(XLSX_MAGIC) + 1), XLSX_MAGIC)

    def test_verified_capture_rejects_digest_mismatch(self):
        with self.assertRaises(ScheduleImportError):
            verified_capture(capture_for(XLSX_MAGIC, sha256="0" * 64), XLSX_MAGIC)

    def test_verified_capture_rejects_non_excel_content(self):
        content = b"<html>login</html>"
        with self.assertRaises(ScheduleImportError):
            verified_capture(capture_for(content), content)


if __name__ == "__main__":
    unittest.main()


import base64
import tempfile
from pathlib import Path
from unittest.mock import patch

from qlu_toolbox.modules.schedule_import import service as capture_service


class FakeFrame:
    def __init__(self, results, base64_payload=""):
        self.results = list(results)
        self.base64_payload = base64_payload
        self.calls = 0

    def evaluate(self, script):
        if script.startswith("() =>"):
            return self.base64_payload
        self.calls += 1
        return self.results[min(self.calls - 1, len(self.results) - 1)]


class FakePage:
    def __init__(self, frames):
        self.frames = frames
        self.listeners = {}

    def on(self, event, handler):
        self.listeners[event] = handler

    def remove_listener(self, event, handler):
        self.listeners.pop(event, None)

    def emit_download(self, handler_arg):
        handler = self.listeners.get("download")
        if handler:
            handler(handler_arg)


class FakeDownload:
    def __init__(self, target: Path, content: bytes):
        self.target = target
        self.content = content

    def save_as(self, path):
        Path(path).write_bytes(self.content)


class EmitSink:
    def __init__(self):
        self.events = []

    def __call__(self, event):
        self.events.append(event)


class WaitForCaptureTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.work_root = Path(self.temporary.name)
        self.emit = EmitSink()

    def tearDown(self):
        self.temporary.cleanup()

    def test_capture_via_interceptor_in_every_frame(self):
        content = XLSX_MAGIC
        pending = {
            "ok": True,
            "total": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
        }
        main_frame = FakeFrame([None])
        school_frame = FakeFrame([None, {"installed": True, "result": None}, {"installed": True, "result": pending}],
                                 base64_payload=base64.b64encode(content).decode())
        page = FakePage([main_frame, school_frame])
        with patch.object(capture_service, "POLL_INTERVAL_SECONDS", 0.01):
            result, extension = capture_service._wait_for_capture(page, self.work_root, self.emit, __import__("threading").Event())
        self.assertEqual(result, content)
        self.assertEqual(extension, ".xlsx")

    def test_capture_via_download_fallback(self):
        content = XLS_MAGIC
        fallback_file = self.work_root / "fallback.bin"

        class TriggerFrame:
            def __init__(self, page):
                self.page = page
                self.fired = False

            def evaluate(self, script):
                if not script.startswith("() =>") and not self.fired:
                    self.fired = True
                    self.page.emit_download(FakeDownload(fallback_file, content))
                return None

        page = FakePage([TriggerFrame(page=None)])
        page.frames = [TriggerFrame(page)]
        with patch.object(capture_service, "POLL_INTERVAL_SECONDS", 0.01):
            result, extension = capture_service._wait_for_capture(page, self.work_root, self.emit, __import__("threading").Event())
        self.assertEqual(result, content)
        self.assertEqual(extension, "")
