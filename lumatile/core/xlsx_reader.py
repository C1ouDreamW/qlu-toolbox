from __future__ import annotations

from pathlib import Path, PurePosixPath
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
MAX_FILE_SIZE = 20 * 1024 * 1024
MAX_XML_SIZE = 50 * 1024 * 1024


class WorkbookReadError(ValueError):
    pass


def _safe_archive_read(archive: ZipFile, name: str) -> bytes:
    try:
        info = archive.getinfo(name)
    except KeyError as exc:
        raise WorkbookReadError("Excel 文件结构不完整") from exc
    if info.file_size > MAX_XML_SIZE:
        raise WorkbookReadError("Excel 工作表过大，无法安全读取")
    return archive.read(info)


def _first_sheet_path(archive: ZipFile) -> str:
    workbook = ElementTree.fromstring(_safe_archive_read(archive, "xl/workbook.xml"))
    sheet = workbook.find(f".//{{{MAIN_NS}}}sheets/{{{MAIN_NS}}}sheet")
    if sheet is None:
        raise WorkbookReadError("Excel 中没有可读取的工作表")
    relation_id = sheet.get(f"{{{REL_NS}}}id", "")
    relationships = ElementTree.fromstring(
        _safe_archive_read(archive, "xl/_rels/workbook.xml.rels")
    )
    target = ""
    for relationship in relationships.findall(f"{{{PACKAGE_REL_NS}}}Relationship"):
        if relationship.get("Id") == relation_id:
            target = relationship.get("Target", "")
            break
    if not target:
        raise WorkbookReadError("无法定位 Excel 工作表")
    if target.startswith("/"):
        path = PurePosixPath(target.lstrip("/"))
    else:
        path = PurePosixPath("xl") / target
    parts: list[str] = []
    for part in path.parts:
        if part == "..":
            if parts:
                parts.pop()
        elif part not in {"", "."}:
            parts.append(part)
    resolved = "/".join(parts)
    if not resolved.startswith("xl/"):
        raise WorkbookReadError("Excel 工作表路径无效")
    return resolved


def _column_index(reference: str) -> int:
    letters = "".join(char for char in reference.upper() if char.isalpha())
    if not letters:
        return 0
    result = 0
    for char in letters:
        result = result * 26 + ord(char) - ord("A") + 1
    return result - 1


def read_xlsx_rows(path: Path) -> list[list[str]]:
    if not path.is_file():
        raise WorkbookReadError("所选文件不存在")
    if path.stat().st_size > MAX_FILE_SIZE:
        raise WorkbookReadError("Excel 文件超过 20 MB，无法读取")
    try:
        with ZipFile(path) as archive:
            shared_strings: list[str] = []
            if "xl/sharedStrings.xml" in archive.namelist():
                shared_root = ElementTree.fromstring(
                    _safe_archive_read(archive, "xl/sharedStrings.xml")
                )
                for item in shared_root.findall(f"{{{MAIN_NS}}}si"):
                    shared_strings.append(
                        "".join(node.text or "" for node in item.findall(f".//{{{MAIN_NS}}}t"))
                    )

            sheet_root = ElementTree.fromstring(
                _safe_archive_read(archive, _first_sheet_path(archive))
            )
            result: list[list[str]] = []
            for row in sheet_root.findall(f".//{{{MAIN_NS}}}sheetData/{{{MAIN_NS}}}row"):
                values: dict[int, str] = {}
                for cell in row.findall(f"{{{MAIN_NS}}}c"):
                    index = _column_index(cell.get("r", ""))
                    cell_type = cell.get("t", "")
                    if cell_type == "inlineStr":
                        value = "".join(
                            node.text or "" for node in cell.findall(f".//{{{MAIN_NS}}}t")
                        )
                    else:
                        node = cell.find(f"{{{MAIN_NS}}}v")
                        value = node.text if node is not None and node.text is not None else ""
                        if cell_type == "s" and value:
                            try:
                                value = shared_strings[int(value)]
                            except (ValueError, IndexError) as exc:
                                raise WorkbookReadError("Excel 共享文本索引无效") from exc
                    values[index] = value.strip()
                if values:
                    result.append([values.get(index, "") for index in range(max(values) + 1)])
            return result
    except (BadZipFile, ElementTree.ParseError, OSError) as exc:
        raise WorkbookReadError("无法读取该 XLSX 文件，请重新导出后再试") from exc
