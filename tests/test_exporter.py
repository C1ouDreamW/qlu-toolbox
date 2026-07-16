from __future__ import annotations

import unittest
import tempfile
import threading
from datetime import datetime
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs
from zipfile import ZIP_DEFLATED, ZipFile

from qlu_toolbox.modules.grade_export.domain import (
    ExportError,
    ExportOptions,
    build_export_body,
    default_academic_year,
    is_logged_in_url,
    output_path,
    workbook_extension,
    xlsx_semester_values,
)
from qlu_toolbox.core.paths import AppPaths
from qlu_toolbox.modules.grade_export.service import _launch_context


class ExporterTests(unittest.TestCase):
    def test_missing_browsers_pause_then_launch_downloaded_chromium(self):
        class FakePlaywrightError(Exception):
            pass

        class FakeChromium:
            executable_path = "C:/missing/chrome.exe"

            def __init__(self):
                self.managed_attempts = 0

            def launch_persistent_context(self, **kwargs):
                if kwargs.get("channel"):
                    raise FakePlaywrightError("channel unavailable")
                self.managed_attempts += 1
                if self.managed_attempts == 1:
                    raise FakePlaywrightError("Executable doesn't exist")
                return "managed-context"

        class FakePlaywright:
            chromium = FakeChromium()

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = AppPaths(
                root / "config",
                root / "data",
                root / "logs",
                root / "profiles",
                root / "browsers",
            )
            paths.ensure()
            events: list[dict[str, object]] = []
            ready = threading.Event()
            ready.set()
            with patch(
                "qlu_toolbox.modules.grade_export.service.AppPaths.discover",
                return_value=paths,
            ):
                context, transient = _launch_context(
                    FakePlaywright(),
                    FakePlaywrightError,
                    ExportOptions("2025", "12", root),
                    events.append,
                    threading.Event(),
                    ready,
                )
            self.assertEqual(context, "managed-context")
            self.assertIsNone(transient)
            self.assertIn("browser_required", [event["type"] for event in events])

    def test_default_academic_year_changes_in_august(self):
        self.assertEqual(default_academic_year(datetime(2026, 7, 15)), "2025")
        self.assertEqual(default_academic_year(datetime(2026, 8, 1)), "2026")

    def test_export_body_preserves_all_repeated_columns(self):
        parsed = parse_qs(build_export_body("2025", "12"))
        self.assertEqual(parsed["xnm"], ["2025"])
        self.assertEqual(parsed["xqm"], ["12"])
        self.assertEqual(len(parsed["exportModel.selectCol"]), 9)
        self.assertIn("xmblmc@成绩分项", parsed["exportModel.selectCol"])

    def test_detects_excel_formats(self):
        self.assertEqual(workbook_extension(b"PK\x03\x04rest"), ".xlsx")
        self.assertEqual(workbook_extension(bytes.fromhex("D0CF11E0A1B11AE1") + b"rest"), ".xls")
        with self.assertRaises(ExportError):
            workbook_extension(b"<html>login</html>", "text/html")

    def test_logged_in_urls(self):
        self.assertTrue(is_logged_in_url("https://jw.qlu.edu.cn/jwglxt/xtgl/index_initMenu.html?jsdm=xs"))
        self.assertTrue(is_logged_in_url("https://jw.qlu.edu.cn/jwglxt/cjcx/test.html"))
        self.assertTrue(is_logged_in_url("https://jw.qlu.edu.cn/jwglxt/anything?jsdm=xs"))
        self.assertFalse(is_logged_in_url("https://jw.qlu.edu.cn/"))
        self.assertFalse(is_logged_in_url("https://example.com/jwglxt/cjcx/test.html"))

    def test_output_name_contains_school_year(self):
        options = ExportOptions("2025", "12", Path("C:/tmp"))
        path = output_path(options, ".xlsx")
        self.assertIn("2025-2026", path.name)
        self.assertIn("第2学期", path.name)
        self.assertEqual(path.suffix, ".xlsx")

    def test_reads_semester_column_from_xlsx(self):
        shared_strings = """<?xml version="1.0" encoding="UTF-8"?>
        <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <si><t>课程名称</t></si><si><t>学期</t></si><si><t>测试课程</t></si>
        </sst>"""
        worksheet = """<?xml version="1.0" encoding="UTF-8"?>
        <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
          <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
          <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>2</v></c></row>
          <row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3"><v>2</v></c></row>
        </sheetData></worksheet>"""
        buffer = BytesIO()
        with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
            archive.writestr("xl/sharedStrings.xml", shared_strings)
            archive.writestr("xl/worksheets/sheet1.xml", worksheet)
        self.assertEqual(xlsx_semester_values(buffer.getvalue()), {"2"})


if __name__ == "__main__":
    unittest.main()
