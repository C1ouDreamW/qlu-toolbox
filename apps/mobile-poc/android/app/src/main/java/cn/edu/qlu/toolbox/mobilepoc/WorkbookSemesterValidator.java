package cn.edu.qlu.toolbox.mobilepoc;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

final class WorkbookSemesterValidator {
    private static final int MAX_XML_BYTES = 32 * 1024 * 1024;

    private WorkbookSemesterValidator() {}

    static Set<String> readSemesterValues(File workbook) throws IOException {
        try (ZipFile archive = new ZipFile(workbook)) {
            List<String> sharedStrings = readSharedStrings(archive);
            ZipEntry sheetEntry = archive.getEntry("xl/worksheets/sheet1.xml");
            if (sheetEntry == null) throw new IOException("工作簿缺少第一个工作表");
            Document sheet = parseXml(archive.getInputStream(sheetEntry));
            NodeList rows = sheet.getElementsByTagName("row");
            if (rows.getLength() == 0) return Set.of();

            String semesterColumn = null;
            Element header = (Element) rows.item(0);
            NodeList headerCells = header.getElementsByTagName("c");
            for (int index = 0; index < headerCells.getLength(); index++) {
                Element cell = (Element) headerCells.item(index);
                if ("学期".equals(cellValue(cell, sharedStrings).trim())) {
                    semesterColumn = columnOf(cell.getAttribute("r"));
                    break;
                }
            }
            if (semesterColumn == null) throw new IOException("工作簿缺少学期列");

            Set<String> values = new HashSet<>();
            for (int rowIndex = 1; rowIndex < rows.getLength(); rowIndex++) {
                Element row = (Element) rows.item(rowIndex);
                NodeList cells = row.getElementsByTagName("c");
                for (int cellIndex = 0; cellIndex < cells.getLength(); cellIndex++) {
                    Element cell = (Element) cells.item(cellIndex);
                    if (!semesterColumn.equals(columnOf(cell.getAttribute("r")))) continue;
                    String value = cellValue(cell, sharedStrings).trim();
                    if (!value.isEmpty()) values.add(value);
                    break;
                }
            }
            return values;
        } catch (IOException error) {
            throw error;
        } catch (Exception error) {
            throw new IOException("无法解析工作簿学期", error);
        }
    }

    private static List<String> readSharedStrings(ZipFile archive) throws Exception {
        ZipEntry entry = archive.getEntry("xl/sharedStrings.xml");
        if (entry == null) return List.of();
        Document document = parseXml(archive.getInputStream(entry));
        NodeList items = document.getElementsByTagName("si");
        List<String> values = new ArrayList<>();
        for (int index = 0; index < items.getLength(); index++) {
            values.add(textFromDescendants((Element) items.item(index), "t"));
        }
        return values;
    }

    private static Document parseXml(InputStream input) throws Exception {
        try (input) {
            byte[] content = readLimited(input);
            String xml = new String(content, StandardCharsets.UTF_8);
            if (xml.contains("<!DOCTYPE") || xml.contains("<!ENTITY")) {
                throw new IOException("工作簿包含不允许的 XML 声明");
            }
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(false);
            return factory.newDocumentBuilder().parse(new ByteArrayInputStream(content));
        }
    }

    private static byte[] readLimited(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[16 * 1024];
        int total = 0;
        int count;
        while ((count = input.read(buffer)) != -1) {
            total += count;
            if (total > MAX_XML_BYTES) throw new IOException("工作簿 XML 超过安全限制");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    private static String cellValue(Element cell, List<String> sharedStrings) {
        String type = cell.getAttribute("t");
        if ("inlineStr".equals(type)) return textFromDescendants(cell, "t");
        NodeList values = cell.getElementsByTagName("v");
        if (values.getLength() == 0) return "";
        String raw = values.item(0).getTextContent();
        if (!"s".equals(type)) return raw == null ? "" : raw;
        try {
            int index = Integer.parseInt(raw);
            return index >= 0 && index < sharedStrings.size() ? sharedStrings.get(index) : "";
        } catch (NumberFormatException error) {
            return "";
        }
    }

    private static String textFromDescendants(Element parent, String tagName) {
        NodeList nodes = parent.getElementsByTagName(tagName);
        StringBuilder value = new StringBuilder();
        for (int index = 0; index < nodes.getLength(); index++) {
            Node node = nodes.item(index);
            if (node.getTextContent() != null) value.append(node.getTextContent());
        }
        return value.toString();
    }

    private static String columnOf(String reference) {
        int end = 0;
        while (end < reference.length() && Character.isLetter(reference.charAt(end))) end++;
        return reference.substring(0, end);
    }
}
