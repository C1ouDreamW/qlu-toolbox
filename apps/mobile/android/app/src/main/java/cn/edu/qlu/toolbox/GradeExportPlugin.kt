package cn.edu.qlu.toolbox

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.CookieManager
import android.webkit.WebStorage
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.IOException
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import java.util.regex.Pattern
import org.json.JSONObject

@CapacitorPlugin(name = "GradeExport")
class GradeExportPlugin : Plugin() {
    private lateinit var repository: GradeTaskRepository
    private val workbookExecutor = Executors.newSingleThreadExecutor()

    override fun load() {
        repository = GradeTaskRepository.get(context)
        repository.cleanupExpiredArtifacts()
        repository.reconcileInterruptedTasks()
        GradeExportCoordinator.setEventSink { event -> activity.runOnUiThread { notifyListeners("gradeExportEvent", event, true) } }
    }

    @PluginMethod
    fun start(call: PluginCall) {
        val academicYear = call.getString("academicYear", "") ?: ""
        val semester = call.getString("semester", "") ?: ""
        val keepLogin = call.getBoolean("keepLoginState", true) == true
        if (!YEAR.matcher(academicYear).matches() || semester !in setOf("3", "12")) {
            call.reject("学年或学期参数无效")
            return
        }
        if (repository.getActive() != null || GradeExportCoordinator.hasAttachedActivity()) {
            call.reject("已有查分任务正在进行，请先完成或取消当前任务")
            return
        }
        val taskId = UUID.randomUUID().toString()
        repository.create(taskId, academicYear, semester)
        GradeExportCoordinator.expectLaunch(taskId)
        activity.startActivity(Intent(context, GradeExportActivity::class.java).apply {
            putExtra(GradeExportActivity.EXTRA_TASK_ID, taskId)
            putExtra(GradeExportActivity.EXTRA_ACADEMIC_YEAR, academicYear)
            putExtra(GradeExportActivity.EXTRA_SEMESTER, semester)
            putExtra(GradeExportActivity.EXTRA_KEEP_LOGIN, keepLogin)
        })
        call.resolve(JSObject().apply { put("taskId", taskId) })
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        val taskId = call.getString("taskId", "") ?: ""
        if (GradeExportCoordinator.cancel(taskId)) { call.resolve(); return }
        val task = repository.get(taskId)
        if (task?.outcome == "running") {
            val updated = repository.cancel(taskId, "操作已取消")
            updated?.let { emit("cancelled", it, "操作已取消") }
            call.resolve()
        } else call.reject("查分页面已关闭或任务不存在")
    }

    @PluginMethod
    fun getActiveTask(call: PluginCall) {
        resolveTask(call, repository.getActive())
    }

    @PluginMethod
    fun getTask(call: PluginCall) {
        resolveTask(call, repository.get(call.getString("taskId", "") ?: ""))
    }

    @PluginMethod
    fun listTasks(call: PluginCall) {
        val tasks = repository.list(call.getInt("limit", 100) ?: 100).map(GradeTaskEntity::toJsObject)
        call.resolve(JSObject().apply { put("tasks", JSArray(tasks)) })
    }

    @PluginMethod
    fun saveArtifact(call: PluginCall) {
        val task = repository.getByArtifact(call.getString("artifactId", "") ?: "")
        if (task == null) { call.reject("ARTIFACT_UNAVAILABLE"); return }
        startSave(call, task)
    }

    @PluginMethod
    fun retrySave(call: PluginCall) {
        val task = repository.get(call.getString("taskId", "") ?: "")
        if (task == null) { call.reject("任务不存在"); return }
        startSave(call, task)
    }

    private fun startSave(call: PluginCall, task: GradeTaskEntity) {
        if (repository.artifactFile(task) == null) {
            repository.markUnavailable(task.taskId)
            call.reject("ARTIFACT_UNAVAILABLE")
            return
        }
        call.data.put("taskId", task.taskId)
        startActivityForResult(call, Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = GradeTaskRepository.XLSX_MIME
            putExtra(Intent.EXTRA_TITLE, task.displayName)
        }, "saveArtifactResult")
    }

    @ActivityCallback
    private fun saveArtifactResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val taskId = call.getString("taskId", "") ?: ""
        val task = repository.get(taskId)
        val source = task?.let(repository::artifactFile)
        val destination = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || destination == null) {
            task?.let { emit("save_cancelled", it, "已取消保存，导出文件仍可再次保存") }
            call.resolve(JSObject().apply { put("savedArtifact", JSONObject.NULL) })
            return
        }
        if (task == null || source == null) { call.reject("ARTIFACT_UNAVAILABLE"); return }
        try {
            source.inputStream().use { input ->
                context.contentResolver.openOutputStream(destination, "w")?.use(input::copyTo)
                    ?: throw IOException("系统未提供可写输出流")
            }
            try {
                context.contentResolver.takePersistableUriPermission(destination, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            } catch (_: SecurityException) { }
            val saved = repository.markSaved(taskId, destination.toString()) ?: task
            emit("artifact_saved", saved, "成绩文件已保存")
            call.resolve(JSObject().apply { put("savedArtifact", saved.toJsObject().getJSONObject("savedArtifact")) })
        } catch (_: IOException) {
            call.reject("保存文件失败，请检查目标位置后重试")
        }
    }

    @PluginMethod
    fun shareArtifact(call: PluginCall) {
        val task = repository.getByArtifact(call.getString("artifactId", "") ?: "")
        if (task == null) { call.reject("ARTIFACT_UNAVAILABLE"); return }
        val uri = readableUri(task)
        if (uri == null) { repository.markUnavailable(task.taskId); call.reject("ARTIFACT_UNAVAILABLE"); return }
        try {
            activity.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                type = GradeTaskRepository.XLSX_MIME
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }, "分享成绩文件"))
            call.resolve()
        } catch (_: ActivityNotFoundException) { call.reject("未找到可接收 XLSX 的应用") }
    }

    @PluginMethod
    fun openSavedArtifact(call: PluginCall) {
        val task = repository.get(call.getString("taskId", "") ?: "")
        val uri = task?.savedUri?.let(Uri::parse)
        if (task == null || uri == null) { call.reject("ARTIFACT_UNAVAILABLE"); return }
        try {
            activity.startActivity(Intent.createChooser(Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, GradeTaskRepository.XLSX_MIME)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }, "打开成绩文件"))
            call.resolve()
        } catch (_: ActivityNotFoundException) { call.reject("未找到可打开 XLSX 的应用") }
    }

    @PluginMethod
    fun releaseArtifact(call: PluginCall) {
        repository.releaseArtifact(call.getString("artifactId", "") ?: "")
        call.resolve()
    }

    @PluginMethod
    fun readArtifactWorkbook(call: PluginCall) {
        val task = repository.getByArtifact(call.getString("artifactId", "") ?: "")
        val file = task?.let(repository::artifactFile)
        if (task == null || file == null) {
            task?.let { repository.markUnavailable(it.taskId) }
            call.reject("ARTIFACT_UNAVAILABLE")
            return
        }
        workbookExecutor.execute {
            resolveWorkbook(call, file, task.displayName ?: "成绩.xlsx")
        }
    }

    @PluginMethod
    fun pickGradeWorkbook(call: PluginCall) {
        startActivityForResult(call, Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = XLSX_MIME
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf(XLSX_MIME, "application/octet-stream"))
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }, "pickGradeWorkbookResult")
    }

    @ActivityCallback
    private fun pickGradeWorkbookResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            call.resolve(JSObject().apply { put("workbook", JSONObject.NULL) })
            return
        }
        workbookExecutor.execute {
            val temporary = File.createTempFile("gpa-import-", ".xlsx", context.cacheDir)
            try {
                copyPickedWorkbook(uri, temporary)
                val workbook = workbookObject(displayName(uri), WorkbookValidator.readRows(temporary))
                call.resolve(JSObject().apply { put("workbook", workbook) })
            } catch (error: IOException) {
                call.reject("无法读取成绩文件：${error.message ?: "文件格式无效"}")
            } finally {
                temporary.delete()
            }
        }
    }

    @PluginMethod
    fun clearLoginState(call: PluginCall) {
        activity.runOnUiThread {
            CookieManager.getInstance().removeAllCookies {
                CookieManager.getInstance().flush()
                WebStorage.getInstance().deleteAllData()
                bridge.webView.clearCache(true)
                call.resolve()
            }
        }
    }

    private fun resolveTask(call: PluginCall, task: GradeTaskEntity?) {
        call.resolve(JSObject().apply { put("task", task?.toJsObject() ?: JSONObject.NULL) })
    }

    private fun resolveWorkbook(call: PluginCall, file: File, fileName: String) {
        try {
            call.resolve(JSObject().apply { put("workbook", workbookObject(fileName, WorkbookValidator.readRows(file))) })
        } catch (error: IOException) {
            call.reject("无法读取成绩文件：${error.message ?: "文件格式无效"}")
        }
    }

    private fun workbookObject(fileName: String, rows: List<List<String>>): JSObject = JSObject().apply {
        put("fileName", fileName)
        put("rows", JSArray(rows.map { JSArray(it) }))
    }

    private fun copyPickedWorkbook(uri: Uri, destination: File) {
        val declaredLength = context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
        if (declaredLength > WorkbookValidator.MAX_ARCHIVE_BYTES) throw IOException("Excel 文件超过 20 MiB")
        val input = context.contentResolver.openInputStream(uri) ?: throw IOException("系统未提供可读文件流")
        input.use { source ->
            destination.outputStream().use { output ->
                val buffer = ByteArray(32 * 1024)
                var total = 0L
                while (true) {
                    val count = source.read(buffer)
                    if (count == -1) break
                    total += count
                    if (total > WorkbookValidator.MAX_ARCHIVE_BYTES) throw IOException("Excel 文件超过 20 MiB")
                    output.write(buffer, 0, count)
                }
            }
        }
    }

    private fun displayName(uri: Uri): String {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) return cursor.getString(0)?.takeIf(String::isNotBlank) ?: "成绩.xlsx"
        }
        return uri.lastPathSegment?.substringAfterLast('/')?.takeIf(String::isNotBlank) ?: "成绩.xlsx"
    }

    private fun readableUri(task: GradeTaskEntity): Uri? {
        val file = repository.artifactFile(task)
        if (file != null) return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        return task.savedUri?.let(Uri::parse)
    }

    private fun emit(type: String, task: GradeTaskEntity, message: String) {
        GradeExportCoordinator.emit(JSObject().apply {
            put("type", type); put("seq", task.seq); put("taskId", task.taskId); put("stage", task.stage); put("message", message)
            if (type == "artifact_saved") put("savedArtifact", task.toJsObject().getJSONObject("savedArtifact"))
        })
    }

    companion object {
        private const val XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        private val YEAR = Pattern.compile("20\\d{2}")
    }
}
