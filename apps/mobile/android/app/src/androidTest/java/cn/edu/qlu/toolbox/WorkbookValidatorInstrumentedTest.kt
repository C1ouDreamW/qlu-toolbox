package cn.edu.qlu.toolbox

import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.FileOutputStream
import java.nio.charset.StandardCharsets
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Test

class WorkbookValidatorInstrumentedTest {
    @Test
    fun parsesWorkbookWithTheDeviceDocumentBuilderFactory() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val workbook = File.createTempFile("android-workbook-", ".xlsx", context.cacheDir)
        try {
            ZipOutputStream(FileOutputStream(workbook)).use { output ->
                entry(output, "xl/workbook.xml", """
                    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
                        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
                      <sheets><sheet name="成绩" sheetId="1" r:id="rId1"/></sheets>
                    </workbook>
                """.trimIndent())
                entry(output, "xl/_rels/workbook.xml.rels", """
                    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                      <Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>
                    </Relationships>
                """.trimIndent())
                entry(output, "xl/sharedStrings.xml", """
                    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                    <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
                      <si><t>课程名称</t></si><si><t>学期</t></si><si><t>脱敏课程</t></si>
                    </sst>
                """.trimIndent())
                entry(output, "xl/worksheets/sheet1.xml", """
                    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
                      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
                      <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>2</v></c></row>
                    </sheetData></worksheet>
                """.trimIndent())
            }

            assertEquals(setOf("2"), WorkbookValidator.validate(workbook).semesters)
            assertEquals(listOf("课程名称", "学期"), WorkbookValidator.readRows(workbook).first())
            assertEquals(listOf("脱敏课程", "2"), WorkbookValidator.readRows(workbook)[1])
        } finally {
            workbook.delete()
        }
    }

    private fun entry(output: ZipOutputStream, name: String, content: String) {
        output.putNextEntry(ZipEntry(name))
        output.write(content.toByteArray(StandardCharsets.UTF_8))
        output.closeEntry()
    }
}
