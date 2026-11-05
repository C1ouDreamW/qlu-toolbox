from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from pathlib import Path
from urllib.parse import urlencode, urlparse
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile


BASE_URL = "https://jw.qlu.edu.cn/"
HOME_URL_MARKER = "/jwglxt/xtgl/index_initMenu.html"
SCORE_URL = (
    "https://jw.qlu.edu.cn/jwglxt/cjcx/"
    "cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default"
)
EXPORT_URL = "https://jw.qlu.edu.cn/jwglxt/cjcx/cjcx_dcXsKccjList.html"

SEMESTERS = {"1": "3", "2": "12"}

EXPORT_COLUMNS = (
    "kcmc@课程名称",
    "xnmmc@学年",
    "xqmmc@学期",
    "kkbmmc@开课学院",
    "kch@课程代码",
    "jxbmc@教学班",
    "xf@学分",
    "xmcj@成绩",
    "xmblmc@成绩分项",
)


class ExportError(RuntimeError):
    pass


class CancelledError(ExportError):
    pass


@dataclass(frozen=True)
class ExportOptions:
    academic_year: str
    semester_value: str
    output_dir: Path
    preferred_browser: str = "auto"
    keep_login_state: bool = True


def default_academic_year(now: datetime | None = None) -> str:
    now = now or datetime.now()
    return str(now.year if now.month >= 8 else now.year - 1)


def validate_academic_year(label: str) -> str:
    parts = label.strip().split("-")
    if not (
        len(parts) == 2
        and all(part.isdigit() and len(part) == 4 for part in parts)
        and 2000 <= int(parts[0]) <= 2100
        and int(parts[1]) == int(parts[0]) + 1
    ):
        raise ValueError("学年格式应为 2025-2026")
    return parts[0]


def build_export_body(academic_year: str, semester_value: str) -> str:
    fields: list[tuple[str, str]] = [
        ("gnmkdmKey", "N305005"),
        ("xnm", academic_year),
        ("xqm", semester_value),
        ("dcclbh", "JW_N305005_GLY"),
    ]
    fields.extend(("exportModel.selectCol", column) for column in EXPORT_COLUMNS)
    fields.extend((("exportModel.exportWjgs", "xls"), ("fileName", "成绩单")))
    return urlencode(fields)


def workbook_extension(content: bytes, content_type: str = "") -> str:
    if content.startswith(b"PK\x03\x04"):
        return ".xlsx"
    if content.startswith(bytes.fromhex("D0CF11E0A1B11AE1")):
        return ".xls"
    lowered = content_type.lower()
    if "spreadsheetml" in lowered:
        return ".xlsx"
    if "ms-excel" in lowered:
        return ".xls"
    raise ExportError("服务器返回的不是 Excel 文件，登录可能已失效")


def output_path(options: ExportOptions, extension: str) -> Path:
    school_year = f"{options.academic_year}-{int(options.academic_year) + 1}"
    semester = semester_label(options.semester_value)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base = options.output_dir / (
        f"齐鲁工业大学分项成绩_{school_year}_第{semester}学期_{stamp}{extension}"
    )
    if not base.exists():
        return base
    for index in range(2, 1000):
        candidate = base.with_stem(f"{base.stem}_{index}")
        if not candidate.exists():
            return candidate
    raise ExportError("保存目录中同名文件过多，请更换保存目录后重试")


def atomic_save(destination: Path, content: bytes) -> None:
    temporary = destination.with_name(f".{destination.name}.part")
    try:
        with temporary.open("wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(destination)
    except OSError:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def semester_label(semester_value: str) -> str:
    return next(
        (label for label, value in SEMESTERS.items() if value == semester_value),
        semester_value,
    )


@dataclass(frozen=True)
class SemesterScan:
    """成绩表中“学期”列的扫描结果。"""

    values: set[str]
    has_data_rows: bool


def xlsx_semester_scan(content: bytes) -> SemesterScan:
    """扫描 OOXML 工作簿中的“学期”列，不引入额外 Excel 依赖。

    无法定位“学期”表头时按存在数据行处理，避免把结构变化误报成“暂无成绩”。
    """
    namespace = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    try:
        with ZipFile(BytesIO(content)) as archive:
            shared_strings: list[str] = []
            if "xl/sharedStrings.xml" in archive.namelist():
                shared_root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
                for item in shared_root.findall("x:si", namespace):
                    shared_strings.append(
                        "".join(node.text or "" for node in item.findall(".//x:t", namespace))
                    )

            sheet_root = ElementTree.fromstring(archive.read("xl/worksheets/sheet1.xml"))
            rows = sheet_root.findall(".//x:sheetData/x:row", namespace)
            if not rows:
                return SemesterScan(values=set(), has_data_rows=False)

            def cell_value(cell) -> str:
                cell_type = cell.get("t", "")
                if cell_type == "inlineStr":
                    return "".join(node.text or "" for node in cell.findall(".//x:t", namespace))
                value_node = cell.find("x:v", namespace)
                if value_node is None or value_node.text is None:
                    return ""
                if cell_type == "s":
                    index = int(value_node.text)
                    return shared_strings[index] if 0 <= index < len(shared_strings) else ""
                return value_node.text

            header_column = None
            for cell in rows[0].findall("x:c", namespace):
                if cell_value(cell).strip() == "学期":
                    reference = cell.get("r", "")
                    header_column = "".join(char for char in reference if char.isalpha())
                    break
            if not header_column:
                return SemesterScan(values=set(), has_data_rows=True)

            values: set[str] = set()
            for row in rows[1:]:
                for cell in row.findall("x:c", namespace):
                    reference = cell.get("r", "")
                    column = "".join(char for char in reference if char.isalpha())
                    if column == header_column:
                        value = cell_value(cell).strip()
                        if value:
                            values.add(value)
                        break
            return SemesterScan(values=values, has_data_rows=bool(rows[1:]))
    except (BadZipFile, KeyError, ElementTree.ParseError, ValueError) as exc:
        raise ExportError("无法读取服务器返回的 Excel 文件") from exc


def xlsx_semester_values(content: bytes) -> set[str]:
    """读取 OOXML 工作簿中的“学期”列，不引入额外 Excel 依赖。"""
    return xlsx_semester_scan(content).values


def is_logged_in_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    path = parsed.path.rstrip("/")
    if parsed.hostname != "jw.qlu.edu.cn":
        return False
    return (
        HOME_URL_MARKER in path
        or "/jwglxt/cjcx/" in f"{path}/"
        or (path.startswith("/jwglxt/") and "jsdm=xs" in parsed.query)
    )

