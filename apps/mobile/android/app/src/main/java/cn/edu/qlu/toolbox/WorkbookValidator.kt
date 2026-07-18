package cn.edu.qlu.toolbox

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Document
import org.w3c.dom.Element

internal data class WorkbookValidation(val semesters: Set<String>, val sha256: String)

internal object WorkbookValidator {
    const val MAX_ARCHIVE_BYTES = 20L * 1024 * 1024
    private const val MAX_ENTRY_COUNT = 256
    private const val MAX_ENTRY_BYTES = 32L * 1024 * 1024
    private const val MAX_TOTAL_BYTES = 64L * 1024 * 1024
    private const val MAX_COMPRESSION_RATIO = 100L
    private const val MAX_WORKSHEET_ROWS = 20_000
    private const val MAX_WORKSHEET_COLUMNS = 256
    private const val MAX_WORKSHEET_CELLS = 200_000
    private const val MAX_WORKSHEET_TEXT_CHARS = 8 * 1024 * 1024

    fun validate(file: File): WorkbookValidation {
        validateArchiveFile(file)
        ZipFile(file).use { archive ->
            validateEntries(archive)
            val sharedStrings = readSharedStrings(archive)
            val sheet = parseXml(readEntry(archive, firstSheetPath(archive)))
            val semesters = readSemesterValues(sheet, sharedStrings)
            if (semesters.isEmpty()) throw IOException("工作簿学期列没有有效数据")
            return WorkbookValidation(semesters, sha256(file))
        }
    }

    fun readRows(file: File): List<List<String>> {
        validateArchiveFile(file)
        ZipFile(file).use { archive ->
            validateEntries(archive)
            val sharedStrings = readSharedStrings(archive)
            val sheet = parseXml(readEntry(archive, firstSheetPath(archive)))
            return readWorksheetRows(sheet, sharedStrings)
        }
    }

    private fun validateArchiveFile(file: File) {
        if (!file.isFile || file.length() <= 0 || file.length() > MAX_ARCHIVE_BYTES) throw IOException("文件为空或超过 20 MiB")
        file.inputStream().use { input ->
            val magic = ByteArray(4)
            if (input.read(magic) != 4 || !magic.contentEquals(byteArrayOf('P'.code.toByte(), 'K'.code.toByte(), 3, 4))) {
                throw IOException("不是 ZIP/OOXML XLSX 文件")
            }
        }
    }

    private fun validateEntries(archive: ZipFile) {
        var count = 0
        var total = 0L
        val entries = archive.entries()
        while (entries.hasMoreElements()) {
            val entry = entries.nextElement()
            count++
            if (count > MAX_ENTRY_COUNT) throw IOException("ZIP 条目数量超过安全限制")
            validateEntryName(entry.name)
            val size = entry.size
            val compressed = entry.compressedSize
            if (size > MAX_ENTRY_BYTES) throw IOException("ZIP 单个条目超过安全限制")
            if (size > 0) {
                total += size
                if (total > MAX_TOTAL_BYTES) throw IOException("ZIP 总解压大小超过安全限制")
                if (compressed == 0L || (compressed > 0 && size / compressed > MAX_COMPRESSION_RATIO)) {
                    throw IOException("ZIP 压缩比超过安全限制")
                }
            }
        }
    }

    private fun validateEntryName(name: String) {
        if (name.startsWith('/') || name.startsWith('\\') || name.contains('\\') || name.split('/').any { it == ".." }) {
            throw IOException("ZIP 包含不安全路径")
        }
    }

    private fun firstSheetPath(archive: ZipFile): String {
        val workbook = parseXml(readEntry(archive, "xl/workbook.xml"))
        val sheets = workbook.getElementsByTagName("sheet")
        if (sheets.length == 0) throw IOException("工作簿没有工作表")
        val relationshipId = (sheets.item(0) as Element).getAttribute("r:id")
        if (relationshipId.isBlank()) return "xl/worksheets/sheet1.xml"

        val relationships = parseXml(readEntry(archive, "xl/_rels/workbook.xml.rels"))
        val nodes = relationships.getElementsByTagName("Relationship")
        for (index in 0 until nodes.length) {
            val relation = nodes.item(index) as Element
            if (relation.getAttribute("Id") == relationshipId) {
                return resolveSheetTarget(relation.getAttribute("Target"))
            }
        }
        throw IOException("无法定位工作表关系")
    }

    private fun resolveSheetTarget(target: String): String {
        val raw = if (target.startsWith('/')) target.removePrefix("/") else "xl/$target"
        val parts = mutableListOf<String>()
        for (part in raw.split('/')) {
            when (part) {
                "", "." -> Unit
                ".." -> if (parts.isNotEmpty()) parts.removeAt(parts.lastIndex) else throw IOException("工作表路径无效")
                else -> parts += part
            }
        }
        val resolved = parts.joinToString("/")
        if (!resolved.startsWith("xl/") || !resolved.endsWith(".xml")) throw IOException("工作表路径无效")
        return resolved
    }

    private fun readSharedStrings(archive: ZipFile): List<String> {
        val entry = archive.getEntry("xl/sharedStrings.xml") ?: return emptyList()
        val document = parseXml(readEntry(archive, entry))
        val items = document.getElementsByTagName("si")
        return (0 until items.length).map { textFromDescendants(items.item(it) as Element, "t") }
    }

    private fun readSemesterValues(sheet: Document, sharedStrings: List<String>): Set<String> {
        val rows = sheet.getElementsByTagName("row")
        var semesterColumn: String? = null
        val headerLimit = minOf(rows.length, 10)
        var headerIndex = -1
        for (rowIndex in 0 until headerLimit) {
            val cells = (rows.item(rowIndex) as Element).getElementsByTagName("c")
            for (cellIndex in 0 until cells.length) {
                val cell = cells.item(cellIndex) as Element
                if (cellValue(cell, sharedStrings).trim() == "学期") {
                    semesterColumn = columnOf(cell.getAttribute("r"))
                    headerIndex = rowIndex
                    break
                }
            }
            if (semesterColumn != null) break
        }
        val column = semesterColumn ?: throw IOException("工作簿缺少学期列")
        val values = linkedSetOf<String>()
        for (rowIndex in (headerIndex + 1) until rows.length) {
            val cells = (rows.item(rowIndex) as Element).getElementsByTagName("c")
            for (cellIndex in 0 until cells.length) {
                val cell = cells.item(cellIndex) as Element
                if (columnOf(cell.getAttribute("r")) != column) continue
                cellValue(cell, sharedStrings).trim().takeIf(String::isNotEmpty)?.let(values::add)
                break
            }
        }
        return values
    }

    private fun readWorksheetRows(sheet: Document, sharedStrings: List<String>): List<List<String>> {
        val nodes = sheet.getElementsByTagName("row")
        if (nodes.length > MAX_WORKSHEET_ROWS) throw IOException("工作表行数超过安全限制")
        val rows = ArrayList<List<String>>(nodes.length)
        var totalCells = 0
        var totalCharacters = 0
        for (rowIndex in 0 until nodes.length) {
            val cells = (nodes.item(rowIndex) as Element).getElementsByTagName("c")
            totalCells += cells.length
            if (totalCells > MAX_WORKSHEET_CELLS) throw IOException("工作表单元格数量超过安全限制")
            val values = linkedMapOf<Int, String>()
            for (cellIndex in 0 until cells.length) {
                val cell = cells.item(cellIndex) as Element
                val column = columnIndex(cell.getAttribute("r"))
                if (column >= MAX_WORKSHEET_COLUMNS) throw IOException("工作表列数超过安全限制")
                val value = cellValue(cell, sharedStrings).trim()
                totalCharacters += value.length
                if (totalCharacters > MAX_WORKSHEET_TEXT_CHARS) throw IOException("工作表文本大小超过安全限制")
                values[column] = value
            }
            if (values.isNotEmpty()) {
                val lastColumn = values.keys.maxOrNull() ?: 0
                rows += (0..lastColumn).map { values[it].orEmpty() }
            }
        }
        return rows
    }

    private fun cellValue(cell: Element, sharedStrings: List<String>): String {
        val type = cell.getAttribute("t")
        if (type == "inlineStr") return textFromDescendants(cell, "t")
        val values = cell.getElementsByTagName("v")
        if (values.length == 0) return ""
        val raw = values.item(0).textContent.orEmpty()
        if (type != "s") return raw
        val index = raw.toIntOrNull() ?: throw IOException("Excel 共享文本索引无效")
        return sharedStrings.getOrNull(index) ?: throw IOException("Excel 共享文本索引无效")
    }

    private fun textFromDescendants(parent: Element, tag: String): String {
        val nodes = parent.getElementsByTagName(tag)
        return buildString { for (index in 0 until nodes.length) append(nodes.item(index).textContent.orEmpty()) }
    }

    private fun columnOf(reference: String): String = reference.takeWhile(Char::isLetter)

    private fun columnIndex(reference: String): Int {
        val letters = columnOf(reference.uppercase())
        if (letters.isEmpty()) return 0
        var result = 0
        for (letter in letters) result = result * 26 + (letter.code - 'A'.code + 1)
        return result - 1
    }

    private fun readEntry(archive: ZipFile, name: String): ByteArray = readEntry(
        archive,
        archive.getEntry(name) ?: throw IOException("工作簿缺少 $name"),
    )

    private fun readEntry(archive: ZipFile, entry: ZipEntry): ByteArray {
        if (entry.size > MAX_ENTRY_BYTES) throw IOException("XML 条目超过安全限制")
        return readLimited(archive.getInputStream(entry))
    }

    private fun readLimited(input: InputStream): ByteArray = input.use {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        var total = 0
        while (true) {
            val count = it.read(buffer)
            if (count == -1) break
            total += count
            if (total > MAX_ENTRY_BYTES) throw IOException("XML 条目超过安全限制")
            output.write(buffer, 0, count)
        }
        output.toByteArray()
    }

    private fun parseXml(content: ByteArray): Document {
        val xml = String(content, StandardCharsets.UTF_8)
        if (xml.contains("<!DOCTYPE", ignoreCase = true) || xml.contains("<!ENTITY", ignoreCase = true)) {
            throw IOException("工作簿包含不允许的 XML 声明")
        }
        try {
            val factory = DocumentBuilderFactory.newInstance()
            factory.isNamespaceAware = false
            return factory.newDocumentBuilder().parse(ByteArrayInputStream(content))
        } catch (error: Exception) {
            val detail = error.message?.takeIf { it.isNotBlank() } ?: error.javaClass.simpleName
            throw IOException("无法解析工作簿 XML：$detail", error)
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(32 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count == -1) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
