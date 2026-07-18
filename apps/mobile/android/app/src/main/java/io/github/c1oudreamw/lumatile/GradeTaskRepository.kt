package io.github.c1oudreamw.lumatile

import android.content.Context
import com.getcapacitor.JSObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.Executors

internal class GradeTaskRepository private constructor(context: Context) {
    private val dao = GradeTaskDatabase.get(context.applicationContext).tasks()
    private val executor = Executors.newSingleThreadExecutor()
    val artifactDirectory = File(context.cacheDir, "grade-artifacts").apply { mkdirs() }

    private fun <T> db(block: () -> T): T = executor.submit<T> { block() }.get()

    fun create(taskId: String, academicYear: String, semester: String): GradeTaskEntity {
        val now = timestamp()
        val task = GradeTaskEntity(taskId, academicYear, semester, "checking_access", "running", "none", "正在连接教务系统…", "", null, null, null, 0, null, null, null, now, now, 0)
        db { dao.put(task) }
        return task
    }

    fun get(taskId: String): GradeTaskEntity? = db { dao.get(taskId) }
    fun getByArtifact(artifactId: String): GradeTaskEntity? = db { dao.getByArtifact(artifactId) }
    fun getActive(): GradeTaskEntity? = db { dao.getActive() }
    fun list(limit: Int): List<GradeTaskEntity> = db { dao.list(limit.coerceIn(1, 200)) }

    fun update(taskId: String, transform: (GradeTaskEntity) -> GradeTaskEntity): GradeTaskEntity? = db {
        val current = dao.get(taskId) ?: return@db null
        transform(current).copy(updatedAt = timestamp(), seq = current.seq + 1).also(dao::put)
    }

    fun stage(taskId: String, stage: String, message: String): GradeTaskEntity? = update(taskId) {
        if (it.outcome != "running") it else it.copy(stage = stage, message = message)
    }

    fun fail(taskId: String, code: String, message: String, interrupted: Boolean = false): GradeTaskEntity? = update(taskId) {
        if (it.outcome != "running") it else it.copy(stage = if (interrupted) "interrupted" else "failed", outcome = if (interrupted) "interrupted" else "failed", message = message, errorCode = code)
    }

    fun interrupt(taskId: String, code: String, message: String): GradeTaskEntity? =
        fail(taskId, code, message, interrupted = true)

    fun cancel(taskId: String, message: String): GradeTaskEntity? = update(taskId) {
        if (it.outcome != "running") it else it.copy(stage = "cancelled", outcome = "cancelled", message = message)
    }

    fun artifactReady(taskId: String, file: File, displayName: String, sha256: String): GradeTaskEntity? {
        val artifactId = UUID.randomUUID().toString()
        val destination = File(artifactDirectory, "$artifactId.xlsx")
        if (!file.renameTo(destination)) {
            file.copyTo(destination, overwrite = true)
            file.delete()
        }
        return update(taskId) {
            it.copy(
                stage = "artifact_ready",
                outcome = "success",
                artifactState = "temporary",
                message = "成绩文件已导出，可选择保存位置",
                artifactId = artifactId,
                displayName = displayName,
                mimeType = XLSX_MIME,
                size = destination.length(),
                sha256 = sha256,
                expiresAt = timestamp(24L * 60 * 60 * 1000),
            )
        }
    }

    fun markSaved(taskId: String, uri: String): GradeTaskEntity? = update(taskId) {
        it.copy(stage = "success", outcome = "success", artifactState = "saved", message = "成绩文件已保存", savedUri = uri)
    }

    fun markUnavailable(taskId: String): GradeTaskEntity? = update(taskId) {
        it.copy(artifactState = "unavailable", message = "成绩文件已不可访问，请重新导出")
    }

    fun releaseArtifact(artifactId: String) {
        val task = getByArtifact(artifactId) ?: return
        File(artifactDirectory, "$artifactId.xlsx").delete()
        update(task.taskId) { it.copy(artifactState = "unavailable", message = "临时成绩文件已释放") }
    }

    fun artifactFile(task: GradeTaskEntity): File? = task.artifactId
        ?.let { File(artifactDirectory, "$it.xlsx") }
        ?.takeIf(File::isFile)

    fun reconcileInterruptedTasks(): GradeTaskEntity? {
        val active = getActive() ?: return null
        if (!GradeExportCoordinator.hasAttachedActivity()) {
            return interrupt(active.taskId, "TASK_INTERRUPTED", "上次查分任务因 App 中断，需要重新开始")
        }
        return active
    }

    fun cleanupExpiredArtifacts() {
        val expired = db { dao.expiredArtifacts(timestamp()) }
        expired.forEach { task ->
            task.artifactId?.let { File(artifactDirectory, "$it.xlsx").delete() }
            markUnavailable(task.taskId)
        }
    }

    companion object {
        const val XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        @Volatile private var instance: GradeTaskRepository? = null

        fun get(context: Context): GradeTaskRepository = instance ?: synchronized(this) {
            instance ?: GradeTaskRepository(context.applicationContext).also { instance = it }
        }

        private fun timestamp(offsetMillis: Long = 0): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date(System.currentTimeMillis() + offsetMillis))
    }
}

internal fun GradeTaskEntity.toJsObject(): JSObject = JSObject().apply {
    put("taskId", taskId)
    put("academicYear", academicYear)
    put("semester", semester)
    put("stage", stage)
    put("outcome", outcome)
    put("artifactState", artifactState)
    put("message", message)
    put("errorCode", errorCode)
    put("createdAt", createdAt)
    put("updatedAt", updatedAt)
    if (artifactId != null && displayName != null && mimeType != null && sha256 != null) {
        put("artifact", JSObject().apply {
            put("id", artifactId)
            put("displayName", displayName)
            put("mimeType", mimeType)
            put("size", size)
            put("sha256", sha256)
            put("expiresAt", expiresAt)
        })
    } else put("artifact", null)
    if (savedUri != null && displayName != null && mimeType != null) {
        put("savedArtifact", JSObject().apply {
            put("uri", savedUri)
            put("displayName", displayName)
            put("mimeType", mimeType)
            put("size", size)
        })
    } else put("savedArtifact", null)
}
