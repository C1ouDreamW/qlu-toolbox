package cn.edu.qlu.toolbox.mobilepoc;

import static org.junit.Assert.assertEquals;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.Test;

public class WorkbookSemesterValidatorTest {
    @Test
    public void readsSemesterColumnFromInlineStringWorkbook() throws Exception {
        File workbook = File.createTempFile("semester-validator-", ".xlsx");
        try {
            String sheet = """
                <?xml version="1.0" encoding="UTF-8"?>
                <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
                  <sheetData>
                    <row r="1"><c r="A1" t="inlineStr"><is><t>课程</t></is></c><c r="B1" t="inlineStr"><is><t>学期</t></is></c></row>
                    <row r="2"><c r="A2" t="inlineStr"><is><t>测试课程</t></is></c><c r="B2" t="inlineStr"><is><t>2</t></is></c></row>
                  </sheetData>
                </worksheet>
                """;
            try (ZipOutputStream output = new ZipOutputStream(new FileOutputStream(workbook))) {
                output.putNextEntry(new ZipEntry("xl/worksheets/sheet1.xml"));
                output.write(sheet.getBytes(StandardCharsets.UTF_8));
                output.closeEntry();
            }
            assertEquals(Set.of("2"), WorkbookSemesterValidator.readSemesterValues(workbook));
        } finally {
            workbook.delete();
        }
    }
}
