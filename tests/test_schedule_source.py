from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from zipfile import ZIP_DEFLATED, ZipFile

from qlu_toolbox.modules.schedule_io import ScheduleSourceError, parse_schedule_source


def _cell(column: str, row: int, value: str) -> str:
    return f'<c r="{column}{row}" t="inlineStr"><is><t>{value}</t></is></c>'


def create_xlsx(path: Path, rows: list[list[str]]) -> None:
    worksheet_rows = []
    for row_number, values in enumerate(rows, start=1):
        cells = "".join(_cell(chr(ord("A") + index), row_number, value) for index, value in enumerate(values))
        worksheet_rows.append(f'<row r="{row_number}">{cells}</row>')
    worksheet = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(worksheet_rows)}</sheetData></worksheet>'
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="课表" sheetId="1" r:id="rId1"/></sheets></workbook>'
    )
    relationships = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        'Target="worksheets/sheet1.xml"/></Relationships>'
    )
    with ZipFile(path, "w", ZIP_DEFLATED) as archive:
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", relationships)
        archive.writestr("xl/worksheets/sheet1.xml", worksheet)


def fake_xls_sheet(rows: list[list[object]]) -> Mock:
    sheet = Mock()
    sheet.nrows = len(rows)
    sheet.ncols = max((len(row) for row in rows), default=0)
    cells = []
    for row in rows:
        row_cells = []
        for value in row:
            cell = Mock()
            if isinstance(value, str):
                cell.ctype = 1
                cell.value = value
            else:
                cell.ctype = 2
                cell.value = value
            row_cells.append(cell)
        cells.append(row_cells)
    sheet.row.side_effect = lambda index: cells[index]
    return sheet


def fake_xls_book(sheet: Mock) -> Mock:
    book = Mock()
    book.datemode = 0
    book.sheet_by_index.return_value = sheet
    return book


class ScheduleSourceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def test_reads_xlsx_workbook_rows(self):
        path = self.root / "课表.xlsx"
        create_xlsx(path, [["2026-2027学年第一学期"], ["", "星期一", "星期二"], ["第一节", "高等数学◇1-16周(单)◇文科楼", ""]])
        result = parse_schedule_source(path)
        self.assertEqual(result["kind"], "workbook")
        self.assertEqual(result["fileName"], "课表.xlsx")
        rows = result["rows"]
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[1][1], "星期一")

    def test_reads_backup_payload_and_strips_bom(self):
        path = self.root / "我的课表.lumatile-schedule.json"
        path.write_bytes(b"\xef\xbb\xbf" + '{"schemaVersion":1,"courses":[]}'.encode("utf-8"))
        result = parse_schedule_source(path)
        self.assertEqual(result["kind"], "backup")
        self.assertEqual(result["fileName"], "我的课表.lumatile-schedule.json")
        self.assertEqual(result["payload"], '{"schemaVersion":1,"courses":[]}')

    def test_rejects_unknown_magic(self):
        path = self.root / "unknown.bin"
        path.write_bytes(b"\x00\x01\x02\x03rest")
        with self.assertRaises(ScheduleSourceError):
            parse_schedule_source(path)

    def test_rejects_missing_file(self):
        with self.assertRaises(ScheduleSourceError):
            parse_schedule_source(self.root / "missing.xlsx")

    def test_rejects_oversize_file(self):
        path = self.root / "big.json"
        path.write_bytes(b"{" + b" " * 64)
        with patch("qlu_toolbox.modules.schedule_io.domain.MAX_FILE_SIZE", 8):
            with self.assertRaises(ScheduleSourceError):
                parse_schedule_source(path)

    def test_rejects_oversize_backup(self):
        path = self.root / "big.json"
        path.write_bytes(b'{"a":"' + b"x" * 64 + b'"}')
        with patch("qlu_toolbox.modules.schedule_io.domain.MAX_BACKUP_SIZE", 8):
            with self.assertRaises(ScheduleSourceError):
                parse_schedule_source(path)

    def test_enforces_row_limit_for_xlsx(self):
        path = self.root / "wide.xlsx"
        create_xlsx(path, [["row"]] * 6)
        with patch("qlu_toolbox.modules.schedule_io.domain.MAX_ROW_COUNT", 5):
            with self.assertRaises(ScheduleSourceError):
                parse_schedule_source(path)

    def test_reads_xls_rows_via_xlrd(self):
        path = self.root / "教务课表.xls"
        path.write_bytes(b"\xd0\xcf\x11\xe0" + b"\x00" * 8)
        sheet = fake_xls_sheet([
            ["2026-2027学年第一学期", ""],
            ["", "星期一"],
            ["第一节", "高等数学"],
            [],
            ["", "大学英语"],
        ])
        book = fake_xls_book(sheet)
        with patch("qlu_toolbox.modules.schedule_io.domain.xlrd.open_workbook", return_value=book):
            result = parse_schedule_source(path)
        rows = result["rows"]
        self.assertEqual(result["kind"], "workbook")
        self.assertEqual(len(rows), 4)
        self.assertEqual(rows[0][0], "2026-2027学年第一学期")
        self.assertEqual(rows[2][1], "高等数学")

    def test_xls_numbers_are_formatted_without_trailing_zero(self):
        path = self.root / "教务课表.xls"
        path.write_bytes(b"\xd0\xcf\x11\xe0" + b"\x00" * 8)
        sheet = fake_xls_sheet([["学分", 2.0], ["成绩", 86.5]])
        book = fake_xls_book(sheet)
        with patch("qlu_toolbox.modules.schedule_io.domain.xlrd.open_workbook", return_value=book):
            result = parse_schedule_source(path)
        rows = result["rows"]
        self.assertEqual(rows[0][1], "2")
        self.assertEqual(rows[1][1], "86.5")

    def test_xls_failure_is_wrapped(self):
        path = self.root / "broken.xls"
        path.write_bytes(b"\xd0\xcf\x11\xe0" + b"\x00" * 8)
        with patch("qlu_toolbox.modules.schedule_io.domain.xlrd.open_workbook", side_effect=ValueError("boom")):
            with self.assertRaises(ScheduleSourceError):
                parse_schedule_source(path)


if __name__ == "__main__":
    unittest.main()
