package io.github.c1oudreamw.lumatile

import java.net.URI

internal object ScheduleImportSecurity {
    const val SCHEDULE_URL = "https://jw.qlu.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N253508&layout=default"

    fun isSchedulePage(rawUrl: String?): Boolean {
        if (!GradeExportSecurity.isAllowedUrl(rawUrl)) return false
        return try {
            val uri = URI.create(rawUrl)
            uri.host.equals(GradeExportSecurity.ACADEMIC_HOST, ignoreCase = true) &&
                uri.path == "/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html"
        } catch (_: IllegalArgumentException) {
            false
        }
    }
}
