package io.github.c1oudreamw.lumatile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.time.Instant
import java.util.concurrent.Executors
import org.apache.poi.hssf.usermodel.HSSFWorkbook
import org.apache.poi.ss.usermodel.DataFormatter
import org.json.JSONObject

@CapacitorPlugin(name = "Schedule")
class SchedulePlugin : Plugin() {
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var dao: ScheduleDao

    override fun load() {
        dao = ScheduleDatabase.get(context).schedules()
    }

    @PluginMethod
    fun list(call: PluginCall) = background(call) {
        JSObject().apply { put("schedules", JSArray(dao.list().map { it.toJson() })) }
    }

    @PluginMethod
    fun save(call: PluginCall) = background(call) {
        val id = call.getString("id", "")!!.trim()
        val name = call.getString("name", "")!!.trim()
        val payload = call.getString("payload", "")!!
        val makeActive = call.getBoolean("makeActive", false) == true
        if (id.isEmpty() || name.isEmpty()) throw IOException("课表名称不能为空")
        validatePayload(payload)
        val previous = dao.get(id)
        val entity = ScheduleEntity(
            scheduleId = id,
            name = name.take(120),
            payload = payload,
            updatedAt = Instant.now().toString(),
            isActive = previous?.isActive == true,
        )
        dao.save(entity, makeActive)
        dao.get(id)?.toJson() ?: throw IOException("课表保存失败")
    }

    @PluginMethod
    fun activate(call: PluginCall) = background(call) {
        val id = call.getString("id", "")!!.trim()
        if (dao.get(id) == null) throw IOException("课表不存在")
        dao.activate(id)
        JSObject().apply { put("ok", true) }
    }

    @PluginMethod
    fun delete(call: PluginCall) = background(call) {
        val id = call.getString("id", "")!!.trim()
        val wasActive = dao.get(id)?.isActive == true
        dao.delete(id)
        if (wasActive) dao.list().firstOrNull()?.let { dao.activate(it.scheduleId) }
        JSObject().apply { put("ok", true) }
    }

    @PluginMethod
    fun pickImport(call: PluginCall) {
        startActivityForResult(call, Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf(
                "application/vnd.ms-excel",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/json",
                "text/json",
            ))
        }, "pickImportResult")
    }

    @ActivityCallback
    private fun pickImportResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            call.resolve(JSObject().apply { put("source", JSONObject.NULL) })
            return
        }
        executor.execute {
            try {
                val name = displayName(uri)
                val bytes = readLimited(uri)
                val source = when {
                    bytes.firstNonWhitespace() == '{'.code.toByte() -> JSObject().apply {
                        put("kind", "backup")
                        put("fileName", name)
                        put("payload", bytes.toString(Charsets.UTF_8))
                    }
                    bytes.startsWith(XLS_MAGIC) -> JSObject().apply {
                        put("kind", "workbook")
                        put("fileName", name)
                        put("rows", JSArray(readXlsRows(bytes).map(::JSArray)))
                    }
                    bytes.startsWith(XLSX_MAGIC) -> JSObject().apply {
                        val file = File.createTempFile("schedule-", ".xlsx", context.cacheDir)
                        try {
                            file.writeBytes(bytes)
                            put("kind", "workbook")
                            put("fileName", name)
                            put("rows", JSArray(WorkbookValidator.readRows(file).map(::JSArray)))
                        } finally { file.delete() }
                    }
                    else -> throw IOException("请选择教务导出的 XLS、XLSX 或课表备份文件")
                }
                activity.runOnUiThread { call.resolve(JSObject().apply { put("source", source) }) }
            } catch (error: Exception) {
                activity.runOnUiThread { call.reject(error.message ?: "无法读取课表文件") }
            }
        }
    }

    @PluginMethod
    fun share(call: PluginCall) {
        val payload = call.getString("payload", "")!!
        validatePayload(payload)
        val requested = call.getString("fileName", "课表.lumatile-schedule.json")!!
        val safeName = requested.replace(Regex("[^\\p{L}\\p{N}._-]"), "_").take(120)
            .ifEmpty { "课表.lumatile-schedule.json" }
        val directory = File(context.cacheDir, "schedule-shares").apply { mkdirs() }
        directory.listFiles()?.forEach { if (it.name != safeName) it.delete() }
        val file = File(directory, safeName).apply { writeText(payload, Charsets.UTF_8) }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        activity.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
            type = "application/json"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }, "分享课表"))
        call.resolve()
    }

    private fun background(call: PluginCall, block: () -> JSObject) {
        executor.execute {
            try {
                val result = block()
                activity.runOnUiThread { call.resolve(result) }
            } catch (error: Exception) {
                activity.runOnUiThread { call.reject(error.message ?: "课表操作失败") }
            }
        }
    }

    private fun validatePayload(payload: String) {
        if (payload.toByteArray().size > MAX_BACKUP_BYTES) throw IOException("课表数据超过 2 MiB")
        val json = try { JSONObject(payload) } catch (_: Exception) { throw IOException("课表数据格式无效") }
        if (json.optInt("schemaVersion") != 1 || !json.has("courses")) throw IOException("课表数据版本不受支持")
    }

    private fun readLimited(uri: Uri): ByteArray = context.contentResolver.openInputStream(uri)?.use { input ->
        val output = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        var total = 0
        while (true) {
            val count = input.read(buffer)
            if (count == -1) break
            total += count
            if (total > MAX_WORKBOOK_BYTES) throw IOException("课表文件超过 20 MiB")
            output.write(buffer, 0, count)
        }
        output.toByteArray()
    } ?: throw IOException("系统无法读取所选文件")

    private fun readXlsRows(bytes: ByteArray): List<List<String>> {
        HSSFWorkbook(ByteArrayInputStream(bytes)).use { workbook ->
            if (workbook.numberOfSheets == 0) throw IOException("工作簿没有工作表")
            val sheet = workbook.getSheetAt(0)
            if (sheet.lastRowNum > MAX_ROWS) throw IOException("课表行数超过安全限制")
            val formatter = DataFormatter()
            var characters = 0
            return (sheet.firstRowNum..sheet.lastRowNum).mapNotNull { rowNumber ->
                val row = sheet.getRow(rowNumber) ?: return@mapNotNull null
                val last = row.lastCellNum.toInt().coerceAtLeast(0)
                if (last > MAX_COLUMNS) throw IOException("课表列数超过安全限制")
                val values = (0 until last).map { formatter.formatCellValue(row.getCell(it)).trim() }
                characters += values.sumOf(String::length)
                if (characters > MAX_TEXT_CHARS) throw IOException("课表文本超过安全限制")
                values.takeIf { cells -> cells.any(String::isNotEmpty) }
            }
        }
    }

    private fun displayName(uri: Uri): String {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) return cursor.getString(0) ?: "课表"
        }
        return uri.lastPathSegment ?: "课表"
    }

    private fun ScheduleEntity.toJson() = JSObject().apply {
        put("id", scheduleId)
        put("name", name)
        put("payload", payload)
        put("updatedAt", updatedAt)
        put("isActive", isActive)
    }

    private fun ByteArray.startsWith(prefix: ByteArray) = size >= prefix.size && prefix.indices.all { this[it] == prefix[it] }
    private fun ByteArray.firstNonWhitespace() = firstOrNull { !it.toInt().toChar().isWhitespace() }

    companion object {
        private const val MAX_WORKBOOK_BYTES = 20 * 1024 * 1024
        private const val MAX_BACKUP_BYTES = 2 * 1024 * 1024
        private const val MAX_ROWS = 20_000
        private const val MAX_COLUMNS = 256
        private const val MAX_TEXT_CHARS = 8 * 1024 * 1024
        private val XLS_MAGIC = byteArrayOf(0xD0.toByte(), 0xCF.toByte(), 0x11, 0xE0.toByte())
        private val XLSX_MAGIC = byteArrayOf('P'.code.toByte(), 'K'.code.toByte(), 3, 4)
    }
}
