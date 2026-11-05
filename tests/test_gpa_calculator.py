from __future__ import annotations

from decimal import Decimal
import tempfile
import unittest
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from lumatile.modules.gpa_calculator.domain import (
    GPAParseError,
    grade_point,
    parse_grade_xlsx,
)


HEADERS = ["课程名称", "学年", "学期", "开课学院", "课程代码", "教学班", "学分", "成绩", "成绩分项"]


def _cell(column: str, row: int, value: str) -> str:
    return f'<c r="{column}{row}" t="inlineStr"><is><t>{value}</t></is></c>'


def create_workbook(path: Path, data_rows: list[list[str]]) -> None:
    rows = [HEADERS, *data_rows]
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
        '<sheets><sheet name="成绩" sheetId="1" r:id="rId1"/></sheets></workbook>'
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


class GPACalculatorTests(unittest.TestCase):
    def test_grade_point_rules(self):
        self.assertEqual(grade_point("95"), Decimal("5.0"))
        self.assertEqual(grade_point("73"), Decimal("2.8"))
        self.assertEqual(grade_point("59"), Decimal("0"))
        self.assertEqual(grade_point("A-"), Decimal("4.2"))
        self.assertEqual(grade_point("良好"), Decimal("3.5"))
        self.assertIsNone(grade_point("通过"))

    def test_parses_components_and_excludes_course_without_final(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "grades.xlsx"
            create_workbook(path, [
                ["大学英语 4", "2025-2026", "2", "外国语学院", "B101004", "英语-07", "2.0", "86.68", "平时成绩(30%)"],
                ["大学英语 4", "2025-2026", "2", "外国语学院", "B101004", "英语-07", "2.0", "73", "总评"],
                ["开放实验", "2025-2026", "2", "实验中心", "X100", "实验-01", "1.0", "90", "实验成绩"],
            ])
            result = parse_grade_xlsx(path)
            self.assertEqual(result["rowCount"], 3)
            self.assertEqual(len(result["courses"]), 2)
            english = result["courses"][0]
            self.assertEqual(english["final_score"], "73")
            self.assertAlmostEqual(english["grade_point"], 2.8)
            self.assertTrue(english["included"])
            self.assertEqual(len(english["components"]), 2)
            experiment = result["courses"][1]
            self.assertFalse(experiment["included"])
            self.assertEqual(experiment["issue"], "没有找到总评成绩")

    def test_rejects_non_xlsx_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "grades.xls"
            path.write_bytes(b"not a workbook")
            with self.assertRaises(GPAParseError):
                parse_grade_xlsx(path)


if __name__ == "__main__":
    unittest.main()
