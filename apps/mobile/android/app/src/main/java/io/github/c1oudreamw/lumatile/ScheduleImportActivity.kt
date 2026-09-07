package io.github.c1oudreamw.lumatile

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.http.SslError
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import org.json.JSONObject
import org.json.JSONTokener

@SuppressLint("SetTextI18n")
class ScheduleImportActivity : AppCompatActivity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var webView: WebView
    private lateinit var statusView: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var actionButton: Button
    private var pageLoaded = false
    private var transferStarted = false
    private var completed = false
    private var resultDelivered = false
    private var temporaryFile: File? = null

    private val accessTimeout = Runnable {
        if (!pageLoaded) fail(SCHOOL_NETWORK_MESSAGE)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = false
        buildUi()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (!transferStarted && webView.canGoBack()) webView.goBack() else cancelAndFinish()
            }
        })
        configureWebView()
        status("正在连接教务系统…请保持校园网或学校 VPN 已连接")
        handler.postDelayed(accessTimeout, ACCESS_TIMEOUT_MS)
        webView.loadUrl(BASE_URL)
    }

    private fun buildUi() {
        val padding = dp(14)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.rgb(244, 248, 252)) }
        val toolbar = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(padding, dp(8), dp(8), dp(8))
            setBackgroundColor(Color.rgb(7, 88, 184))
        }
        toolbar.addView(TextView(this).apply {
            text = "学校教务系统 · 导入课表"; setTextColor(Color.WHITE); textSize = 16f
            setTypeface(null, android.graphics.Typeface.BOLD)
        }, LinearLayout.LayoutParams(0, dp(48), 1f))
        toolbar.addView(Button(this).apply {
            text = "关闭"; setTextColor(Color.WHITE); setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { cancelAndFinish() }
        }, LinearLayout.LayoutParams(dp(72), dp(48)))
        root.addView(toolbar)
        statusView = TextView(this).apply { setPadding(padding, dp(10), padding, dp(10)); setTextColor(Color.rgb(73, 103, 127)); textSize = 13f }
        root.addView(statusView)
        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { isIndeterminate = true }
        root.addView(progressBar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)))
        webView = WebView(this)
        root.addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        actionButton = Button(this).apply {
            text = "我已完成登录，继续"; isAllCaps = false; setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(11, 118, 232)); visibility = View.GONE
            setOnClickListener { verifyLoginAndContinue(true) }
        }
        root.addView(actionButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54)).apply { setMargins(padding, dp(8), padding, dp(12)) })
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(safe.left, 0, safe.right, safe.bottom)
            toolbar.setPadding(padding, dp(8) + safe.top, dp(8), dp(8))
            insets
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
        }
        CookieManager.getInstance().apply { setAcceptCookie(true); setAcceptThirdPartyCookies(webView, false) }
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = RestrictedClient()
    }

    private inner class RestrictedClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = handleNavigation(request.url.toString(), request.isForMainFrame)
        @Deprecated("Deprecated in Android") override fun shouldOverrideUrlLoading(view: WebView, url: String) = handleNavigation(url, true)

        override fun onPageFinished(view: WebView, url: String) {
            if (!GradeExportSecurity.isAllowedUrl(url) || completed) return
            if (!pageLoaded) { pageLoaded = true; handler.removeCallbacks(accessTimeout) }
            if (ScheduleImportSecurity.isSchedulePage(url)) {
                actionButton.visibility = View.GONE
                progressBar.visibility = View.GONE
                status("请选择学年、学期并查询，然后点击页面中的“输出EXCEL”")
                installExportInterceptor()
            } else {
                status("请在学校页面手动登录，完成后 App 会自动进入个人课表")
                actionButton.visibility = View.VISIBLE
                verifyLoginAndContinue(false)
            }
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) fail(if (error.errorCode == ERROR_FAILED_SSL_HANDSHAKE) "安全连接失败，已拒绝绕过证书校验。" else SCHOOL_NETWORK_MESSAGE)
        }
        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            if (request.isForMainFrame && response.statusCode >= 400) fail("教务系统返回 HTTP ${response.statusCode}，请稍后重试。")
        }
        override fun onReceivedSslError(view: WebView, sslHandler: SslErrorHandler, error: SslError) {
            sslHandler.cancel(); fail("安全连接失败，已拒绝绕过证书校验。")
        }
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            fail("教务页面进程已终止，请重新导入。"); return true
        }
    }

    private fun handleNavigation(url: String, mainFrame: Boolean): Boolean {
        if (!mainFrame || GradeExportSecurity.isAllowedUrl(url)) return false
        fail("页面尝试跳转到未确认的域名（${GradeExportSecurity.blockedHost(url)}），已阻止。")
        return true
    }

    private fun verifyLoginAndContinue(manual: Boolean) {
        if (completed || ScheduleImportSecurity.isSchedulePage(webView.url)) return
        if (GradeExportSecurity.isLoggedInUrl(webView.url)) { openSchedulePage(); return }
        webView.evaluateJavascript("(() => Boolean(document.querySelector('#sessionUser') || document.querySelector('#sessionUserKey') || document.querySelector('a[href*=\\\"logout\\\"]')))()") { result ->
            if (result == "true" && GradeExportSecurity.isAllowedUrl(webView.url)) openSchedulePage()
            else if (manual) Toast.makeText(this, "尚未检测到登录成功，请完成登录后再试", Toast.LENGTH_LONG).show()
        }
    }

    private fun openSchedulePage() {
        actionButton.visibility = View.GONE
        status("登录已验证，正在打开个人课表…")
        webView.loadUrl(ScheduleImportSecurity.SCHEDULE_URL)
    }

    private fun installExportInterceptor() {
        webView.evaluateJavascript(buildInterceptorScript()) { installed ->
            if (installed != "true") fail("无法接管课表导出，教务页面可能已更新。")
            else pollExport()
        }
    }

    private fun pollExport() {
        if (completed) return
        webView.evaluateJavascript("JSON.stringify(window.__LUMATILE_SCHEDULE_IMPORT__ && {started:window.__LUMATILE_SCHEDULE_IMPORT__.started,result:window.__LUMATILE_SCHEDULE_IMPORT__.result})") { raw ->
            if (completed) return@evaluateJavascript
            try {
                val encoded = JSONTokener(raw).nextValue() as? String
                val state = encoded?.let(::JSONObject)
                if (state?.optBoolean("started") == true && !transferStarted) {
                    transferStarted = true
                    progressBar.visibility = View.VISIBLE
                    status("正在接收并校验教务课表…")
                }
                val result = state?.optString("result")
                if (result.isNullOrEmpty() || result == "null") handler.postDelayed(::pollExport, POLL_MS)
                else receiveExport(JSONObject(result))
            } catch (_: Exception) { handler.postDelayed(::pollExport, POLL_MS) }
        }
    }

    private fun receiveExport(result: JSONObject) {
        if (!result.optBoolean("ok")) { fail(result.optString("message", "教务系统导出失败")); return }
        val total = result.optLong("total")
        val length = result.optInt("base64Length")
        if (total <= 0 || total > MAX_FILE_SIZE || length <= 0) { fail("导出文件为空或超过 20 MiB 安全限制。"); return }
        temporaryFile = File(cacheDir, "school-schedule-${System.currentTimeMillis()}.part").apply { delete() }
        readChunk(0, length, total, 0, result.optString("sha256"))
    }

    private fun readChunk(offset: Int, base64Length: Int, expectedBytes: Long, writtenBytes: Long, expectedSha256: String) {
        if (completed) return
        if (offset >= base64Length) { finishTransfer(expectedBytes, writtenBytes, expectedSha256); return }
        val end = minOf(offset + CHUNK_SIZE, base64Length)
        webView.evaluateJavascript("window.__LUMATILE_SCHEDULE_IMPORT__.base64.slice($offset,$end)") { raw ->
            try {
                val bytes = Base64.decode(JSONTokener(raw).nextValue() as String, Base64.DEFAULT)
                FileOutputStream(temporaryFile, true).use { it.write(bytes) }
                readChunk(end, base64Length, expectedBytes, writtenBytes + bytes.size, expectedSha256)
            } catch (_: Exception) { fail("Excel 文件传输失败，请重新尝试。") }
        }
    }

    private fun finishTransfer(expectedBytes: Long, writtenBytes: Long, expectedSha256: String) {
        val file = temporaryFile ?: return fail("临时文件不存在，请重新尝试。")
        Thread {
            try {
                if (writtenBytes != expectedBytes || file.length() != expectedBytes) throw IOException("文件长度不一致")
                val digest = MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString("") { "%02x".format(it) }
                if (!digest.equals(expectedSha256, true)) throw IOException("文件摘要不一致")
                val header = ByteArray(4)
                file.inputStream().use { java.io.DataInputStream(it).readFully(header) }
                if (!header.contentEquals(XLS_MAGIC) && !header.contentEquals(XLSX_MAGIC)) throw IOException("响应不是 Excel 文件")
                runOnUiThread {
                    completed = true
                    resultDelivered = true
                    setResult(Activity.RESULT_OK, Intent().putExtra(EXTRA_FILE_PATH, file.absolutePath).putExtra(EXTRA_FILE_NAME, "教务课表.xls"))
                    finish()
                }
            } catch (error: Exception) { runOnUiThread { fail("Excel 文件校验失败：${error.message}") } }
        }.start()
    }

    private fun buildInterceptorScript() = """
        (() => {
          if (window.__LUMATILE_SCHEDULE_IMPORT__?.installed) return true;
          const state = window.__LUMATILE_SCHEDULE_IMPORT__ = {installed:true,started:false,result:null,base64:null};
          const originalSubmit = HTMLFormElement.prototype.submit;
          HTMLFormElement.prototype.submit = function() {
            const url = new URL(this.action || location.href, location.href);
            if (url.origin !== location.origin || !url.pathname.endsWith('/kbcx/xskbcx_cxDcExcelXskb.html')) return originalSubmit.call(this);
            if (state.started) return;
            state.started = true;
            (async () => {
              try {
                const response = await fetch(url.toString(), {method:'POST',credentials:'same-origin',body:new URLSearchParams(new FormData(this))});
                if (!response.ok) return JSON.stringify({ok:false,message:'教务系统导出失败（HTTP ' + response.status + '）'});
                const bytes = new Uint8Array(await response.arrayBuffer());
                if (!bytes.length || bytes.length > $MAX_FILE_SIZE) return JSON.stringify({ok:false,message:'导出文件为空或超过安全限制'});
                const digest = await crypto.subtle.digest('SHA-256', bytes.buffer);
                const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
                let binary = ''; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
                state.base64 = btoa(binary);
                return JSON.stringify({ok:true,total:bytes.length,base64Length:state.base64.length,sha256});
              } catch (error) { return JSON.stringify({ok:false,message:String(error?.message || error)}); }
            })().then(result => state.result = result);
          };
          return true;
        })()
    """.trimIndent()

    private fun status(message: String) { statusView.text = message }
    private fun fail(message: String) {
        if (completed) return
        completed = true
        handler.removeCallbacksAndMessages(null)
        progressBar.visibility = View.GONE
        statusView.text = message
        actionButton.text = "关闭并返回"
        actionButton.visibility = View.VISIBLE
        actionButton.setOnClickListener { cancelAndFinish() }
    }
    private fun cancelAndFinish() { setResult(Activity.RESULT_CANCELED); finish() }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        if (!resultDelivered) temporaryFile?.delete()
        if (::webView.isInitialized) { webView.stopLoading(); webView.loadUrl("about:blank"); webView.removeAllViews(); webView.destroy() }
        super.onDestroy()
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_FILE_PATH = "filePath"
        const val EXTRA_FILE_NAME = "fileName"
        private const val BASE_URL = "https://jw.qlu.edu.cn/"
        private const val MAX_FILE_SIZE = 20L * 1024 * 1024
        private const val CHUNK_SIZE = 128 * 1024
        private const val ACCESS_TIMEOUT_MS = 60_000L
        private const val POLL_MS = 250L
        private const val SCHOOL_NETWORK_MESSAGE = "无法连接教务系统，请连接校园网或使用学校 VPN 后重试。"
        private val XLS_MAGIC = byteArrayOf(0xD0.toByte(), 0xCF.toByte(), 0x11, 0xE0.toByte())
        private val XLSX_MAGIC = byteArrayOf('P'.code.toByte(), 'K'.code.toByte(), 3, 4)
    }
}
