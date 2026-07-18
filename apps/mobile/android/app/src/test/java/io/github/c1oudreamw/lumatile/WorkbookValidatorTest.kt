package io.github.c1oudreamw.lumatile

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.charset.StandardCharsets
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkbookValidatorTest {
    @Test fun readsSemesterFromRelatedInlineStringWorksheet() {
        val sheet = """
            <?xml version="1.0" encoding="UTF-8"?>
            <worksheet><sheetData>
              <row r="1"><c r="A1" t="inlineStr"><is><t>课程</t></is></c><c r="B1" t="inlineStr"><is><t>学期</t></is></c></row>
              <row r="2"><c r="A2" t="inlineStr"><is><t>脱敏课程</t></is></c><c r="B2" t="inlineStr"><is><t>2</t></is></c></row>
            </sheetData></worksheet>
        """.trimIndent()
        withWorkbook(sheet) { workbook ->
            val result = WorkbookValidator.validate(workbook)
            assertEquals(setOf("2"), result.semesters)
            assertEquals(64, result.sha256.length)
            assertTrue(result.sha256.matches(Regex("[0-9a-f]{64}")))
        }
    }

    @Test fun readsSharedStringsAndFindsHeaderWithinFirstTenRows() {
        val sheet = """
            <worksheet><sheetData>
              <row r="1"><c r="A1" t="inlineStr"><is><t>成绩单</t></is></c></row>
              <row r="2"><c r="A2" t="s"><v>0</v></c><c r="C2" t="s"><v>1</v></c></row>
              <row r="3"><c r="A3" t="s"><v>2</v></c><c r="C3"><v>1</v></c></row>
            </sheetData></worksheet>
        """.trimIndent()
        val shared = "<sst><si><t>课程</t></si><si><t>学期</t></si><si><t>脱敏课程</t></si></sst>"
        withWorkbook(sheet, shared) { workbook -> assertEquals(setOf("1"), WorkbookValidator.validate(workbook).semesters) }
    }

    @Test fun readsSparseRowsForSharedGpaCore() {
        val sheet = """
            <worksheet><sheetData>
              <row r="1"><c r="A1" t="inlineStr"><is><t>课程名称</t></is></c><c r="C1" t="inlineStr"><is><t>学分</t></is></c></row>
              <row r="2"><c r="A2" t="inlineStr"><is><t>脱敏课程</t></is></c><c r="C2"><v>2.5</v></c></row>
            </sheetData></worksheet>
        """.trimIndent()
        withWorkbook(sheet) { workbook ->
            assertEquals(
                listOf(listOf("课程名称", "", "学分"), listOf("脱敏课程", "", "2.5")),
                WorkbookValidator.readRows(workbook),
            )
        }
    }

    @Test(expected = IOException::class)
    fun rejectsZipTraversalEntry() {
        val file = File.createTempFile("grade-workbook-", ".xlsx")
        try {
            ZipOutputStream(FileOutputStream(file)).use { output ->
                output.putNextEntry(ZipEntry("../secret.xml")); output.write("x".toByteArray()); output.closeEntry()
            }
            WorkbookValidator.validate(file)
        } finally { file.delete() }
    }

    @Test(expected = IOException::class)
    fun rejectsDoctypeBeforeXmlParsing() {
        withWorkbook("<!DOCTYPE worksheet [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]><worksheet><sheetData/></worksheet>") {
            WorkbookValidator.validate(it)
        }
    }

    private fun withWorkbook(sheet: String, sharedStrings: String? = null, block: (File) -> Unit) {
        val file = File.createTempFile("grade-workbook-", ".xlsx")
        try {
            ZipOutputStream(FileOutputStream(file)).use { output ->
                entry(output, "xl/workbook.xml", "<workbook xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"成绩\" r:id=\"rId1\"/></sheets></workbook>")
                entry(output, "xl/_rels/workbook.xml.rels", "<Relationships><Relationship Id=\"rId1\" Target=\"worksheets/sheet1.xml\"/></Relationships>")
                entry(output, "xl/worksheets/sheet1.xml", sheet)
                if (sharedStrings != null) entry(output, "xl/sharedStrings.xml", sharedStrings)
            }
            block(file)
        } finally { file.delete() }
    }

    private fun entry(output: ZipOutputStream, name: String, content: String) {
        output.putNextEntry(ZipEntry(name))
        output.write(content.toByteArray(StandardCharsets.UTF_8))
        output.closeEntry()
    }
}
