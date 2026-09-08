package io.github.c1oudreamw.lumatile

import android.app.Activity
import android.content.Intent
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import org.json.JSONObject

@CapacitorPlugin(name = "CreditReport")
class CreditReportPlugin : Plugin() {
    private var running = false

    @PluginMethod
    fun start(call: PluginCall) {
        if (running) { call.reject("已有学分统计任务正在进行"); return }
        running = true
        try {
            startActivityForResult(call, Intent(context, ScheduleImportActivity::class.java)
                .putExtra(ScheduleImportActivity.EXTRA_CREDIT_REPORT, true), "creditResult")
        } catch (error: Exception) { running = false; call.reject("无法打开教务页面", error) }
    }

    @ActivityCallback
    private fun creditResult(call: PluginCall?, result: ActivityResult) {
        running = false
        val path = result.data?.getStringExtra(ScheduleImportActivity.EXTRA_FILE_PATH)
        if (result.resultCode != Activity.RESULT_OK || path.isNullOrBlank()) {
            call?.resolve(JSObject().put("capture", JSONObject.NULL)); return
        }
        val file = File(path)
        if (file.canonicalFile.parentFile != context.cacheDir.canonicalFile || !file.name.startsWith("school-schedule-")) {
            call?.reject("学分数据路径无效"); return
        }
        Thread {
            try {
                if (file.length() !in 1..20L * 1024 * 1024) throw IllegalArgumentException("学分数据大小无效")
                val data = JSObject(file.readText(Charsets.UTF_8))
                if (data.optJSONArray("items") == null || data.optJSONObject("course_map") == null) throw IllegalArgumentException("学分数据格式无效")
                activity.runOnUiThread { call?.resolve(JSObject().put("capture", data)) }
            } catch (error: Exception) {
                activity.runOnUiThread { call?.reject(error.message ?: "读取学分数据失败") }
            } finally { file.delete() }
        }.start()
    }
}
