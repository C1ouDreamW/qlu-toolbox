from __future__ import annotations

from pathlib import Path

import xlrd

from qlu_toolbox.core.xlsx_reader import WorkbookReadError, read_xlsx_rows

MAX_FILE_SIZE = 20 * 1024 * 1024
MAX_BACKUP_SIZE = 2 * 1024 * 1024
MAX_ROW_COUNT = 20_000
MAX_COLUMN_COUNT = 256
XLS_MAGIC = b"\xd0\xcf\x11\xe0"
XLSX_MAGIC = b"PK\x03\x04"


class ScheduleSourceError(ValueError):
    pass


def parse_schedule_source(file_path: str | Path) -> dict[str, object]:
    """把本地文件转换成渲染层 parseScheduleRows / parseScheduleBackup 需要的导入源。"""
    path = Path(file_path).expanduser()
    if not path.is_file():
        raise ScheduleSourceError("所选文件不存在")
    size = path.stat().st_size
    if size > MAX_FILE_SIZE:
        raise ScheduleSourceError("文件超过 20 MB 限制")
    with path.open("rb") as handle:
        head = handle.read(8)
    if head.lstrip(b"\xef\xbb\xbf\t\r\n ").startswith(b"{"):
        return _read_backup(path, size)
    if head.startswith(XLS_MAGIC):
        return {"kind": "workbook", "fileName": path.name, "rows": _read_xls_rows(path)}
    if head.startswith(XLSX_MAGIC):
        return {"kind": "workbook", "fileName": path.name, "rows": _read_xlsx_rows(path)}
    raise ScheduleSourceError("无法识别的文件格式，请选择课表导出的 .xls/.xlsx 或课表备份 JSON")


def _read_backup(path: Path, size: int) -> dict[str, object]:
    if size > MAX_BACKUP_SIZE:
        raise ScheduleSourceError("课表备份超过 2 MB 限制")
    try:
        payload = path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError) as exc:
        raise ScheduleSourceError("无法读取课表备份文件") from exc
    return {"kind": "backup", "fileName": path.name, "payload": payload}


def _enforce_limits(rows: list[list[str]]) -> list[list[str]]:
    if len(rows) > MAX_ROW_COUNT:
        raise ScheduleSourceError("课表文件行数超过限制")
    if any(len(row) > MAX_COLUMN_COUNT for row in rows):
        raise ScheduleSourceError("课表文件列数超过限制")
    return rows


def _read_xlsx_rows(path: Path) -> list[list[str]]:
    try:
        return _enforce_limits(read_xlsx_rows(path))
    except WorkbookReadError as exc:
        raise ScheduleSourceError(str(exc)) from exc


def _format_xls_cell(book: "xlrd.Book", cell: "xlrd.sheet.Cell") -> str:
    if cell.ctype == xlrd.XL_CELL_TEXT:
        return str(cell.value).strip()
    if cell.ctype == xlrd.XL_CELL_NUMBER:
        return str(int(cell.value)) if float(cell.value).is_integer() else str(cell.value)
    if cell.ctype == xlrd.XL_CELL_DATE:
        try:
            moment = xlrd.xldate.xldate_as_datetime(cell.value, book.datemode)
            if moment.hour or moment.minute or moment.second:
                return moment.strftime("%H:%M")
            return moment.strftime("%Y-%m-%d")
        except (ValueError, OverflowError):
            return str(cell.value)
    if cell.ctype == xlrd.XL_CELL_BOOLEAN:
        return "1" if cell.value else "0"
    return ""


def _read_xls_rows(path: Path) -> list[list[str]]:
    try:
        book = xlrd.open_workbook(path)
        sheet = book.sheet_by_index(0)
        if sheet.nrows > MAX_ROW_COUNT or sheet.ncols > MAX_COLUMN_COUNT:
            raise ScheduleSourceError("课表文件行列数超过限制")
        rows: list[list[str]] = []
        for row_index in range(sheet.nrows):
            values = [
                _format_xls_cell(book, cell)
                for cell in sheet.row(row_index)[:MAX_COLUMN_COUNT]
            ]
            if any(values):
                rows.append(values)
        return rows
    except ScheduleSourceError:
        raise
    except Exception as exc:
        raise ScheduleSourceError("无法读取该课表文件，请确认是教务导出的 .xls 文件") from exc
