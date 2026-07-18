package io.github.c1oudreamw.lumatile

import java.net.URI

internal object GradeExportSecurity {
    const val ACADEMIC_HOST = "jw.qlu.edu.cn"
    const val SSO_HOST = "sso.qlu.edu.cn"
    private val allowedHosts = setOf(ACADEMIC_HOST, SSO_HOST)

    fun isAllowedUrl(rawUrl: String?): Boolean = try {
        val uri = URI.create(rawUrl ?: return false)
        uri.scheme.equals("https", ignoreCase = true) &&
            uri.host?.lowercase() in allowedHosts &&
            uri.userInfo == null &&
            (uri.port == -1 || uri.port == 443)
    } catch (_: IllegalArgumentException) {
        false
    }

    fun isLoggedInUrl(rawUrl: String?): Boolean {
        if (!isAllowedUrl(rawUrl)) return false
        val uri = URI.create(rawUrl)
        if (!uri.host.equals(ACADEMIC_HOST, ignoreCase = true)) return false
        val path = uri.path.orEmpty()
        val query = uri.query.orEmpty()
        return path.contains("/jwglxt/xtgl/index_initMenu.html") ||
            path.contains("/jwglxt/cjcx/") ||
            (path.startsWith("/jwglxt/") && query.contains("jsdm=xs"))
    }

    fun blockedHost(rawUrl: String?): String = try {
        URI.create(rawUrl.orEmpty()).host?.takeIf { it.isNotBlank() } ?: "未知地址"
    } catch (_: IllegalArgumentException) {
        "未知地址"
    }
}
