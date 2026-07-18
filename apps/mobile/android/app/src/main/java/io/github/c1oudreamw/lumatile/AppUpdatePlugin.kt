package io.github.c1oudreamw.lumatile

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.Executors

@CapacitorPlugin(name = "AppUpdate")
class AppUpdatePlugin : Plugin() {
    private val executor = Executors.newSingleThreadExecutor()

    @Volatile
    private var downloadRunning = false

    @PluginMethod
    fun getCurrentVersion(call: PluginCall) {
        val info = packageInfo(context.packageName)
        call.resolve(JSObject().apply {
            put("applicationId", context.packageName)
            put("versionCode", versionCode(info))
            put("versionName", info.versionName ?: "")
        })
    }

    @PluginMethod
    fun canInstallPackages(call: PluginCall) {
        call.resolve(JSObject().put("allowed", canRequestPackageInstalls()))
    }

    @PluginMethod
    fun openInstallPermissionSettings(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve()
            return
        }
        val intent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${context.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }

    @PluginMethod
    fun downloadAndInstall(call: PluginCall) {
        if (downloadRunning) {
            call.reject("已有更新正在下载", "UPDATE_IN_PROGRESS")
            return
        }
        if (!canRequestPackageInstalls()) {
            call.reject("请先允许此应用安装更新", "INSTALL_PERMISSION_REQUIRED")
            return
        }

        val apkUrl = call.getString("apkUrl")?.trim().orEmpty()
        val expectedSha256 = call.getString("sha256")?.lowercase(Locale.ROOT).orEmpty()
        val expectedVersionCode = call.getInt("versionCode") ?: 0
        val expectedSize = call.getLong("size") ?: 0L
        if (!AppUpdateSecurity.isAllowedDownloadUrl(apkUrl)) {
            call.reject("更新下载地址不受信任", "UNTRUSTED_UPDATE_URL")
            return
        }
        if (!expectedSha256.matches(Regex("[0-9a-f]{64}"))) {
            call.reject("更新清单缺少有效的 SHA-256", "INVALID_UPDATE_HASH")
            return
        }
        if (expectedVersionCode <= currentVersionCode()) {
            call.reject("更新版本号必须高于当前版本", "INVALID_UPDATE_VERSION")
            return
        }

        downloadRunning = true
        executor.execute {
            try {
                val directory = File(context.cacheDir, UPDATE_DIRECTORY).apply { mkdirs() }
                directory.listFiles()?.forEach(File::delete)
                val partial = File(directory, "LumaTile-$expectedVersionCode.apk.part")
                val apk = File(directory, "LumaTile-$expectedVersionCode.apk")
                val result = download(apkUrl, partial, expectedSize)
                if (!result.sha256.equals(expectedSha256, ignoreCase = true)) {
                    partial.delete()
                    throw UpdateException("APK 的 SHA-256 与更新清单不一致", "UPDATE_HASH_MISMATCH")
                }
                if (expectedSize > 0 && result.size != expectedSize) {
                    partial.delete()
                    throw UpdateException("APK 文件大小与更新清单不一致", "UPDATE_SIZE_MISMATCH")
                }
                if (!partial.renameTo(apk)) {
                    partial.copyTo(apk, overwrite = true)
                    partial.delete()
                }
                verifyArchive(apk, expectedVersionCode)
                notifyState("ready", "更新包校验完成，正在打开系统安装界面")
                activity.runOnUiThread {
                    try {
                        val uri = FileProvider.getUriForFile(
                            context,
                            "${context.packageName}.fileprovider",
                            apk,
                        )
                        val intent = Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(uri, APK_MIME)
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        activity.startActivity(intent)
                        call.resolve(JSObject().put("ready", true))
                    } catch (error: Exception) {
                        call.reject("无法打开系统安装界面", "INSTALL_INTENT_FAILED", error)
                    }
                }
            } catch (error: UpdateException) {
                call.reject(error.message, error.code, error)
            } catch (error: Exception) {
                call.reject("更新包下载失败：${error.message ?: "未知错误"}", "UPDATE_DOWNLOAD_FAILED", error)
            } finally {
                downloadRunning = false
            }
        }
    }

    private fun download(url: String, destination: File, expectedSize: Long): DownloadResult {
        var current = URL(url)
        repeat(MAX_REDIRECTS + 1) { redirectCount ->
            if (!AppUpdateSecurity.isAllowedDownloadUrl(current.toString())) {
                throw UpdateException("更新下载发生了不受信任的跳转", "UNTRUSTED_UPDATE_REDIRECT")
            }
            val connection = current.openConnection() as HttpURLConnection
            connection.instanceFollowRedirects = false
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive")
            connection.setRequestProperty("User-Agent", "LumaTile-Android-Updater")
            try {
                val status = connection.responseCode
                if (status in 300..399) {
                    if (redirectCount >= MAX_REDIRECTS) {
                        throw UpdateException("更新下载重定向次数过多", "TOO_MANY_REDIRECTS")
                    }
                    val location = connection.getHeaderField("Location")
                        ?: throw UpdateException("更新下载重定向缺少目标地址", "INVALID_REDIRECT")
                    current = URL(current, location)
                    return@repeat
                }
                if (status != HttpURLConnection.HTTP_OK) {
                    throw UpdateException("更新服务器返回 HTTP $status", "UPDATE_HTTP_ERROR")
                }
                val contentLength = connection.contentLengthLong
                if (contentLength > MAX_APK_BYTES || expectedSize > MAX_APK_BYTES) {
                    throw UpdateException("更新包超过允许的大小", "UPDATE_TOO_LARGE")
                }
                val digest = MessageDigest.getInstance("SHA-256")
                var total = 0L
                var lastPercent = -1
                connection.inputStream.use { input ->
                    FileOutputStream(destination).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            total += count
                            if (total > MAX_APK_BYTES) {
                                throw UpdateException("更新包超过允许的大小", "UPDATE_TOO_LARGE")
                            }
                            output.write(buffer, 0, count)
                            digest.update(buffer, 0, count)
                            val denominator = when {
                                expectedSize > 0 -> expectedSize
                                contentLength > 0 -> contentLength
                                else -> 0L
                            }
                            val percent = if (denominator > 0) ((total * 100) / denominator).toInt().coerceIn(0, 100) else -1
                            if (percent != lastPercent) {
                                lastPercent = percent
                                notifyListeners("updateDownloadProgress", JSObject().apply {
                                    put("state", "downloading")
                                    put("received", total)
                                    put("total", denominator)
                                    put("percent", percent)
                                })
                            }
                        }
                    }
                }
                return DownloadResult(total, digest.digest().toHex())
            } finally {
                connection.disconnect()
            }
        }
        throw UpdateException("无法完成更新下载", "UPDATE_DOWNLOAD_FAILED")
    }

    private fun verifyArchive(apk: File, expectedVersionCode: Int) {
        val candidate = archivePackageInfo(apk)
            ?: throw UpdateException("无法读取更新包信息", "INVALID_APK")
        if (candidate.packageName != context.packageName) {
            throw UpdateException("更新包的 applicationId 与当前应用不一致", "UPDATE_PACKAGE_MISMATCH")
        }
        if (versionCode(candidate) != expectedVersionCode.toLong()) {
            throw UpdateException("更新包版本号与清单不一致", "UPDATE_VERSION_MISMATCH")
        }
        val currentSignatures = signatureDigests(packageInfo(context.packageName))
        val candidateSignatures = signatureDigests(candidate)
        if (currentSignatures.isEmpty() || currentSignatures != candidateSignatures) {
            throw UpdateException("更新包签名与当前应用不一致", "UPDATE_SIGNATURE_MISMATCH")
        }
    }

    private fun packageInfo(packageName: String): PackageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.packageManager.getPackageInfo(
            packageName,
            PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()),
        )
    } else {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
    }

    private fun archivePackageInfo(apk: File): PackageInfo? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.packageManager.getPackageArchiveInfo(
            apk.absolutePath,
            PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()),
        )
    } else {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageArchiveInfo(apk.absolutePath, PackageManager.GET_SIGNING_CERTIFICATES)
    }

    private fun signatureDigests(info: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val signingInfo = info.signingInfo ?: return emptySet()
            if (signingInfo.hasMultipleSigners()) signingInfo.apkContentsSigners else signingInfo.signingCertificateHistory
        } else {
            @Suppress("DEPRECATION")
            info.signatures ?: emptyArray()
        }
        return signatures.map { signature ->
            MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()).toHex()
        }.toSet()
    }

    private fun currentVersionCode(): Long = versionCode(packageInfo(context.packageName))

    private fun versionCode(info: PackageInfo): Long = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        info.longVersionCode
    } else {
        @Suppress("DEPRECATION")
        info.versionCode.toLong()
    }

    private fun canRequestPackageInstalls(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    private fun notifyState(state: String, message: String) {
        notifyListeners("updateDownloadProgress", JSObject().apply {
            put("state", state)
            put("message", message)
        })
    }

    override fun handleOnDestroy() {
        executor.shutdownNow()
        super.handleOnDestroy()
    }

    private data class DownloadResult(val size: Long, val sha256: String)
    private class UpdateException(message: String, val code: String) : Exception(message)

    companion object {
        private const val UPDATE_DIRECTORY = "app-updates"
        private const val APK_MIME = "application/vnd.android.package-archive"
        private const val CONNECT_TIMEOUT_MS = 15_000
        private const val READ_TIMEOUT_MS = 60_000
        private const val MAX_REDIRECTS = 5
        private const val MAX_APK_BYTES = 250L * 1024 * 1024
    }
}

private fun ByteArray.toHex(): String = joinToString("") { byte -> "%02x".format(byte) }

internal object AppUpdateSecurity {
    fun isAllowedDownloadUrl(value: String): Boolean {
        return try {
            val uri = URI(value)
            if (!uri.scheme.equals("https", ignoreCase = true) || uri.userInfo != null || uri.port !in listOf(-1, 443)) return false
            val host = uri.host?.lowercase(Locale.ROOT) ?: return false
            when (host) {
                "github.com" -> uri.path.startsWith("/C1ouDreamW/qlu-toolbox/releases/download/") ||
                    uri.path.startsWith("/C1ouDreamW/lumatile/releases/download/")
                "objects.githubusercontent.com", "release-assets.githubusercontent.com" -> true
                else -> false
            }
        } catch (_: Exception) {
            false
        }
    }
}
