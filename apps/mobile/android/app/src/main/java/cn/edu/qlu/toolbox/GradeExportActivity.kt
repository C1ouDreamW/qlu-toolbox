package cn.edu.qlu.toolbox

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.getcapacitor.JSObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

@SuppressLint("SetTextI18n")
class GradeExportActivity : AppCompatActivity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var repository: GradeTaskRepository
    private lateinit var webView: WebView
    private lateinit var statusView: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var actionButton: Button
    private lateinit var taskId: String
    private lateinit var academicYear: String
    private lateinit var semester: String
    private var keepLoginState = true
    private var firstPageLoaded = false
    private var scoreWorkflowStarted = false
    private var workflowTerminal = false
    private var temporaryFile: File? = null

    private val accessTimeout = Runnable {
        if (!firstPageLoaded) fail("SCHOOL_UNREACHABLE", "无法访问教务系统。请检查 aTrust、校园网或服务器状态。")
    }

    private val saveDocument = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val destination = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || destination == null) {
            statusView.text = "已取消保存，导出文件仍可再次保存"
            emit("save_cancelled", "artifact_ready", "已取消保存，导出文件仍可再次保存")
            showSaveButton()
            return@registerForActivityResult
        }
        val task = repository.get(taskId)
        val source = task?.let(repository::artifactFile)
        if (task == null || source == null) {
            repository.markUnavailable(taskId)
            showTerminalMessage("临时导出文件已不存在，请重新导出。")
            return@registerForActivityResult
        }
        try {
            source.inputStream().use { input ->
                contentResolver.openOutputStream(destination, "w")?.use(input::copyTo)
                    ?: throw IOException("系统未提供可写输出流")
            }
            try {
                contentResolver.takePersistableUriPermission(destination, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            } catch (_: SecurityException) {
                // 部分文档提供器不支持持久化授权，当前会话保存仍然有效。
            }
            val saved = repository.markSaved(taskId, destination.toString()) ?: task
            emit("artifact_saved", "success", "成绩文件已保存", saved)
            cleanupLoginIfNeeded()
            progressBar.isIndeterminate = false
            progressBar.progress = 100
            statusView.text = "保存完成，可交给 WPS 或 Excel 打开"
            actionButton.text = "用 WPS / Excel 打开"
            actionButton.visibility = View.VISIBLE
            actionButton.setOnClickListener { openSavedFile(destination) }
        } catch (_: IOException) {
            statusView.text = "保存文件失败，请检查目标位置后重试。"
            emit("error", "artifact_ready", "保存文件失败，请检查目标位置后重试。", code = "SAVE_FAILED")
            showSaveButton()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = false
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val id = intent.getStringExtra(EXTRA_TASK_ID)
        val year = intent.getStringExtra(EXTRA_ACADEMIC_YEAR)
        val term = intent.getStringExtra(EXTRA_SEMESTER)
        if (id == null || year == null || term == null) { finish(); return }
        taskId = id
        academicYear = year
        semester = term
        keepLoginState = intent.getBooleanExtra(EXTRA_KEEP_LOGIN, true)
        repository = GradeTaskRepository.get(this)
        buildUi()
        val existingTask = repository.get(taskId)
        if (existingTask == null) {
            workflowTerminal = true
            showTerminalMessage("查分任务不存在，请返回工具箱重新开始。")
            return
        }
        val expectedLaunch = GradeExportCoordinator.consumeExpectedLaunch(taskId)
        if (savedInstanceState != null || !expectedLaunch || existingTask.outcome != "running") {
            val recreatedRunningTask = existingTask.outcome == "running" && (savedInstanceState != null || !expectedLaunch)
            val code = if (savedInstanceState != null) "ACTIVITY_RECREATED" else "PROCESS_RECREATED"
            val message = if (savedInstanceState != null) "查分页面被系统重建，原会话已安全中断，请重新开始" else "查分进程被系统恢复，原会话已安全中断，请重新开始"
            val restored = if (recreatedRunningTask) repository.interrupt(taskId, code, message) else existingTask
            workflowTerminal = true
            if (restored?.outcome == "interrupted" && restored.seq != existingTask.seq) {
                emit("interrupted", "interrupted", restored.message, restored, restored.errorCode)
                cleanupLoginIfNeeded()
            }
            showTerminalMessage(restored?.message ?: "查分任务已结束，请返回工具箱查看记录。")
            return
        }
        GradeExportCoordinator.attach(this)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (::webView.isInitialized && webView.canGoBack() && !scoreWorkflowStarted) webView.goBack()
                else if (isTaskActive()) cancelTask(taskId)
                else { isEnabled = false; onBackPressedDispatcher.onBackPressed() }
            }
        })
        configureWebView()
        status("checking_access", "正在连接教务系统…")
        handler.postDelayed(accessTimeout, ACCESS_TIMEOUT_MS)
        webView.loadUrl(BASE_URL)
    }

    private fun buildUi() {
        val padding = dp(14)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.rgb(244, 248, 252)) }
        val toolbarTopPadding = dp(8)
        val toolbarEndPadding = dp(8)
        val toolbarBottomPadding = dp(8)
        val toolbar = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(padding, toolbarTopPadding, toolbarEndPadding, toolbarBottomPadding)
            setBackgroundColor(Color.rgb(7, 88, 184))
        }
        toolbar.addView(TextView(this).apply { text = "学校教务系统 · 安全登录"; setTextColor(Color.WHITE); textSize = 16f; setTypeface(null, android.graphics.Typeface.BOLD) }, LinearLayout.LayoutParams(0, dp(48), 1f))
        toolbar.addView(Button(this).apply { text = "关闭"; setTextColor(Color.WHITE); setBackgroundColor(Color.TRANSPARENT); setOnClickListener { closeScreen() } }, LinearLayout.LayoutParams(dp(72), dp(48)))
        root.addView(toolbar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        statusView = TextView(this).apply { setPadding(padding, dp(10), padding, dp(10)); setTextColor(Color.rgb(73, 103, 127)); textSize = 13f }
        root.addView(statusView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { isIndeterminate = true }
        root.addView(progressBar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)))
        webView = WebView(this)
        root.addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        actionButton = Button(this).apply {
            text = "我已完成登录，继续"; isAllCaps = false; setTextColor(Color.WHITE); setBackgroundColor(Color.rgb(11, 118, 232)); visibility = View.GONE
            setOnClickListener { verifyLoginAndContinue(manual = true) }
        }
        root.addView(actionButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54)).apply { setMargins(padding, dp(8), padding, dp(12)) })
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val safeInsets = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(safeInsets.left, 0, safeInsets.right, safeInsets.bottom)
            toolbar.setPadding(
                padding,
                toolbarTopPadding + safeInsets.top,
                toolbarEndPadding,
                toolbarBottomPadding,
            )
            insets
        }
        ViewCompat.requestApplyInsets(root)
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
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = handleNavigation(request.url.toString(), request.isForMainFrame)
        @Deprecated("Deprecated in Android") override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = handleNavigation(url, true)

        override fun onPageFinished(view: WebView, url: String) {
            if (workflowTerminal || !GradeExportSecurity.isAllowedUrl(url)) return
            if (!firstPageLoaded) { firstPageLoaded = true; handler.removeCallbacks(accessTimeout) }
            if (url.startsWith(SCORE_URL_BASE)) {
                if (!scoreWorkflowStarted) { scoreWorkflowStarted = true; runScoreExport() }
                return
            }
            status("waiting_login", "请在学校页面手动登录，完成后 App 会自动继续")
            actionButton.visibility = View.VISIBLE
            verifyLoginAndContinue(manual = false)
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            if (error.errorCode == ERROR_FAILED_SSL_HANDSHAKE) fail("TLS_ERROR", "安全连接失败，已拒绝绕过证书校验。")
            else fail("SCHOOL_UNREACHABLE", "无法访问教务系统。请检查 aTrust、校园网或服务器状态。")
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            if (request.isForMainFrame && response.statusCode >= 400) fail("SCHOOL_UNREACHABLE", "教务系统返回 HTTP ${response.statusCode}，请稍后重试。")
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel()
            fail("TLS_ERROR", "安全连接失败，已拒绝绕过证书校验。")
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            if (!workflowTerminal) {
                fail("WEBVIEW_RENDERER_GONE", "教务页面进程已终止，请重新开始查分。", interrupted = true)
                finish()
            }
            return true
        }
    }

    private fun handleNavigation(url: String, mainFrame: Boolean): Boolean {
        if (!mainFrame || GradeExportSecurity.isAllowedUrl(url)) return false
        fail("NAVIGATION_BLOCKED", "页面尝试跳转到未确认的域名（${GradeExportSecurity.blockedHost(url)}），已阻止以保护登录状态。")
        return true
    }

    private fun verifyLoginAndContinue(manual: Boolean) {
        if (scoreWorkflowStarted || workflowTerminal) return
        if (GradeExportSecurity.isLoggedInUrl(webView.url)) { openScorePage(); return }
        webView.evaluateJavascript("(() => Boolean(document.querySelector('#sessionUser') || document.querySelector('#sessionUserKey') || document.querySelector('a[href*=\\\"logout\\\"]')))()") { result ->
            if (result == "true" && GradeExportSecurity.isAllowedUrl(webView.url)) openScorePage()
            else if (manual) Toast.makeText(this, "尚未检测到登录成功，请完成登录后再试", Toast.LENGTH_LONG).show()
        }
    }

    private fun openScorePage() {
        if (scoreWorkflowStarted || workflowTerminal) return
        actionButton.visibility = View.GONE
        status("opening_scores", "登录已验证，正在打开成绩查询页…")
        webView.loadUrl(SCORE_URL)
    }

    private fun runScoreExport() {
        status("querying", "正在设置学年、学期并查询成绩…")
        webView.evaluateJavascript(buildExportScript()) { result ->
            if (result != "true") { fail("QUERY_FAILED", "无法启动成绩查询脚本，请重新打开成绩页面后再试。"); return@evaluateJavascript }
            pollExportResult(SystemClock.elapsedRealtime() + EXPORT_TIMEOUT_MS)
        }
    }

    private fun pollExportResult(deadline: Long) {
        if (workflowTerminal) return
        if (SystemClock.elapsedRealtime() >= deadline) { fail("QUERY_FAILED", "等待成绩查询或导出响应超时，请检查网络后重试。"); return }
        webView.evaluateJavascript("window.__QLU_GRADE_EXPORT__ && window.__QLU_GRADE_EXPORT__[${JSONObject.quote(taskId)}] && window.__QLU_GRADE_EXPORT__[${JSONObject.quote(taskId)}].result") { raw ->
            if (workflowTerminal) return@evaluateJavascript
            if (raw == null || raw == "null" || raw == "undefined") { handler.postDelayed({ pollExportResult(deadline) }, POLL_MS); return@evaluateJavascript }
            try {
                val first = JSONTokener(raw).nextValue()
                val value = if (first is String) JSONObject(first) else first as JSONObject
                if (!value.optBoolean("ok")) { fail(value.optString("code", "QUERY_FAILED"), value.optString("message", "成绩查询或导出失败")); return@evaluateJavascript }
                val total = value.getLong("total")
                val base64Length = value.getInt("base64Length")
                if (total <= 0 || total > MAX_FILE_SIZE) { fail("FILE_TOO_LARGE", "导出文件为空或超过 20 MiB 安全限制。"); return@evaluateJavascript }
                temporaryFile = File(cacheDir, "grade-transfer-$taskId.part").apply { delete() }
                status("downloading", "正在分块传输 Excel 文件…")
                readBase64Chunk(0, base64Length, total, 0, value.getString("sha256"))
            } catch (_: Exception) {
                fail("PAGE_CHANGED", "教务系统页面返回了无法识别的结果，页面可能已更新。")
            }
        }
    }

    private fun readBase64Chunk(offset: Int, base64Length: Int, expectedBytes: Long, writtenBytes: Long, expectedSha256: String) {
        if (workflowTerminal) return
        if (offset >= base64Length) { finishTransfer(expectedBytes, writtenBytes, expectedSha256); return }
        val end = minOf(offset + BASE64_CHUNK_SIZE, base64Length)
        val expression = "window.__QLU_GRADE_EXPORT__[${JSONObject.quote(taskId)}].base64.slice($offset,$end)"
        webView.evaluateJavascript(expression) { raw ->
            try {
                val base64 = JSONTokener(raw).nextValue() as? String ?: throw IOException("无效分块")
                val bytes = Base64.decode(base64, Base64.DEFAULT)
                FileOutputStream(temporaryFile, true).use { it.write(bytes) }
                val nextWritten = writtenBytes + bytes.size
                progress(nextWritten, expectedBytes)
                readBase64Chunk(end, base64Length, expectedBytes, nextWritten, expectedSha256)
            } catch (_: Exception) {
                fail("TRANSFER_FAILED", "Excel 文件分块传输失败，请重新尝试。")
            }
        }
    }

    private fun finishTransfer(expectedBytes: Long, writtenBytes: Long, expectedSha256: String) {
        clearJavascriptTask()
        val file = temporaryFile ?: return fail("TRANSFER_FAILED", "临时文件不存在，请重新尝试。")
        status("validating", "正在校验 XLSX 文件…")
        Thread {
            try {
                if (writtenBytes != expectedBytes || file.length() != expectedBytes) throw IOException("文件长度不一致")
                val validation = WorkbookValidator.validate(file)
                if (!validation.sha256.equals(expectedSha256, ignoreCase = true)) throw IntegrityException()
                val desiredSemester = if (semester == "3") "1" else "2"
                if (desiredSemester !in validation.semesters) throw SemesterException(validation.semesters)
                val displayName = "齐鲁工业大学分项成绩_${academicYear}-${academicYear.toInt() + 1}_第${desiredSemester}学期.xlsx"
                val ready = repository.artifactReady(taskId, file, displayName, validation.sha256) ?: throw IOException("任务记录不存在")
                temporaryFile = null
                runOnUiThread {
                    workflowTerminal = true
                    emit("artifact_ready", "artifact_ready", ready.message, ready)
                    launchSaveDocument(ready)
                }
            } catch (_: IntegrityException) {
                runOnUiThread { fail("TRANSFER_INTEGRITY_FAILED", "文件摘要校验失败，已拒绝保存。") }
            } catch (error: SemesterException) {
                val actual = error.values.ifEmpty { setOf("未知") }.joinToString("、")
                runOnUiThread { fail("SEMESTER_MISMATCH", "服务器返回的是第 $actual 学期，与所选学期不一致，已拒绝保存。") }
            } catch (error: IOException) {
                runOnUiThread { fail("WORKBOOK_PARSE_FAILED", "Excel 文件校验失败：${error.message}") }
            }
        }.start()
    }

    private fun buildExportScript(): String {
        val columns = JSONArray(EXPORT_COLUMNS).toString()
        val quotedTask = JSONObject.quote(taskId)
        val quotedYear = JSONObject.quote(academicYear)
        val quotedTerm = JSONObject.quote(semester)
        val quotedExportUrl = JSONObject.quote(EXPORT_URL)
        return """
            (() => {
              const taskId = $quotedTask;
              const root = window.__QLU_GRADE_EXPORT__ || (window.__QLU_GRADE_EXPORT__ = {});
              root[taskId] = {result:null, base64:null};
              (async () => {
                try {
                  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
                  const until = async (test, timeout) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (test()) return true; await sleep(250); } return false; };
                  if (!await until(() => document.querySelector('#xnm') && document.querySelector('#xqm'), 30000)) return JSON.stringify({ok:false,code:'PAGE_CHANGED',message:'成绩页面缺少学年或学期控件'});
                  const year = document.querySelector('#xnm'); const term = document.querySelector('#xqm');
                  if (!await until(() => year.options.length > 1 && term.options.length > 1, 30000)) return JSON.stringify({ok:false,code:'PAGE_CHANGED',message:'学年或学期选项加载超时'});
                  const requestedYear = $quotedYear; const requestedTerm = $quotedTerm;
                  const schoolYear = requestedYear + '-' + (Number(requestedYear) + 1);
                  const yearOption = Array.from(year.options).find(o => o.value === requestedYear) || Array.from(year.options).find(o => (o.textContent || '').includes(schoolYear));
                  const termNumber = requestedTerm === '3' ? '1' : '2'; const termName = requestedTerm === '3' ? '第一' : '第二';
                  const exactTermOption = Array.from(term.options).find(o => o.value === requestedTerm);
                  const termPattern = new RegExp('(^|\\D)' + termNumber + '(\\D|$)');
                  const termOption = exactTermOption || Array.from(term.options).find(o => { const text = (o.textContent || '').trim(); return text.includes(termName) || termPattern.test(text); });
                  if (!yearOption) return JSON.stringify({ok:false,code:'SEMESTER_MISMATCH',message:'成绩页面中没有 ' + schoolYear + ' 学年'});
                  if (!termOption) return JSON.stringify({ok:false,code:'SEMESTER_MISMATCH',message:'成绩页面中没有所选学期'});
                  const selectedYear = yearOption.value; const selectedTerm = termOption.value;
                  year.value = selectedYear; term.value = selectedTerm;
                  year.dispatchEvent(new Event('change',{bubbles:true})); term.dispatchEvent(new Event('change',{bubbles:true}));
                  const search = document.querySelector('#search_go'); if (!search) return JSON.stringify({ok:false,code:'PAGE_CHANGED',message:'成绩页面缺少查询按钮'});
                  search.click(); await sleep(800); await until(() => !window.jQuery || window.jQuery.active === 0, 15000);
                  if (year.value !== selectedYear || term.value !== selectedTerm) return JSON.stringify({ok:false,code:'SEMESTER_MISMATCH',message:'查询后学年或学期发生变化，已拒绝导出'});
                  const body = new URLSearchParams(); body.append('gnmkdmKey','N305005'); body.append('xnm',selectedYear); body.append('xqm',selectedTerm); body.append('dcclbh','JW_N305005_GLY');
                  for (const column of $columns) body.append('exportModel.selectCol', column);
                  body.append('exportModel.exportWjgs','xls'); body.append('fileName','成绩单');
                  const response = await fetch($quotedExportUrl,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body});
                  if (!response.ok) return JSON.stringify({ok:false,code:'EXPORT_HTTP_ERROR',message:'教务系统导出失败（HTTP ' + response.status + '）'});
                  const bytes = new Uint8Array(await response.arrayBuffer());
                  if (!bytes.length || bytes.length > $MAX_FILE_SIZE) return JSON.stringify({ok:false,code:'FILE_TOO_LARGE',message:'导出文件为空或超过安全限制'});
                  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer); const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
                  let binary = ''; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
                  const base64 = btoa(binary); if (root[taskId]) root[taskId].base64 = base64;
                  return JSON.stringify({ok:true,total:bytes.length,base64Length:base64.length,sha256});
                } catch (error) { return JSON.stringify({ok:false,code:'QUERY_FAILED',message:String(error && error.message || error)}); }
              })().then(result => { if (root[taskId]) root[taskId].result = result; });
              return true;
            })()
        """.trimIndent()
    }

    private fun launchSaveDocument(task: GradeTaskEntity? = null) {
        val current = task ?: repository.get(taskId) ?: return
        if (repository.artifactFile(current) == null) { repository.markUnavailable(taskId); showTerminalMessage("临时导出文件已不存在，请重新导出。"); return }
        statusView.text = "请选择 Excel 文件的保存位置"
        actionButton.visibility = View.GONE
        saveDocument.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = GradeTaskRepository.XLSX_MIME
            putExtra(Intent.EXTRA_TITLE, current.displayName)
        })
    }

    private fun showSaveButton() {
        actionButton.text = "重新保存成绩文件"
        actionButton.visibility = View.VISIBLE
        actionButton.setOnClickListener { launchSaveDocument() }
    }

    private fun openSavedFile(uri: Uri) {
        val intent = Intent(Intent.ACTION_VIEW).apply { setDataAndType(uri, GradeTaskRepository.XLSX_MIME); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        try { startActivity(Intent.createChooser(intent, "使用应用打开成绩文件")) }
        catch (_: ActivityNotFoundException) { Toast.makeText(this, "未找到可打开 XLSX 的应用", Toast.LENGTH_LONG).show() }
    }

    private fun status(stage: String, message: String) {
        if (workflowTerminal) return
        statusView.text = message
        val updated = repository.stage(taskId, stage, message)
        emit("status", stage, message, updated)
    }

    private fun progress(loaded: Long, total: Long) {
        emit("transfer_progress", "downloading", "正在传输 Excel 文件…", loaded = loaded, total = total)
    }

    private fun fail(code: String, message: String, interrupted: Boolean = false) {
        if (workflowTerminal) return
        workflowTerminal = true
        handler.removeCallbacks(accessTimeout)
        val updated = repository.fail(taskId, code, message, interrupted)
        statusView.text = message
        progressBar.visibility = View.GONE
        actionButton.text = "关闭并返回"
        actionButton.visibility = View.VISIBLE
        actionButton.setOnClickListener { finish() }
        emit(if (interrupted) "interrupted" else "error", if (interrupted) "interrupted" else "failed", message, updated, code)
        cleanupLoginIfNeeded()
        clearJavascriptTask()
        deleteTemporaryFile()
    }

    private fun emit(type: String, stage: String, message: String, task: GradeTaskEntity? = repository.get(taskId), code: String? = null, loaded: Long? = null, total: Long? = null) {
        val event = JSObject().apply {
            put("type", type); put("taskId", taskId); put("stage", stage); put("message", message); put("seq", task?.seq ?: 0)
            if (code != null) put("code", code)
            if (loaded != null) put("loaded", loaded)
            if (total != null) put("total", total)
            if (type == "artifact_ready" && task != null) put("artifact", task.toJsObject().getJSONObject("artifact"))
            if (type == "artifact_saved" && task != null) put("savedArtifact", task.toJsObject().getJSONObject("savedArtifact"))
        }
        GradeExportCoordinator.emit(event)
    }

    private fun cleanupLoginIfNeeded() {
        if (keepLoginState) { CookieManager.getInstance().flush(); return }
        CookieManager.getInstance().removeAllCookies { CookieManager.getInstance().flush() }
        WebStorage.getInstance().deleteAllData()
        if (::webView.isInitialized) { webView.clearCache(true); webView.clearHistory() }
    }

    private fun clearJavascriptTask() {
        if (::webView.isInitialized) try {
            webView.evaluateJavascript("if(window.__QLU_GRADE_EXPORT__) delete window.__QLU_GRADE_EXPORT__[${JSONObject.quote(taskId)}]") {}
        } catch (_: RuntimeException) {
            // renderer 已终止时只需依赖原生临时文件清理。
        }
    }

    private fun deleteTemporaryFile() { temporaryFile?.delete(); temporaryFile = null }
    private fun showTerminalMessage(message: String) {
        statusView.text = message
        progressBar.visibility = View.GONE
        actionButton.text = "关闭并返回"
        actionButton.visibility = View.VISIBLE
        actionButton.setOnClickListener { finish() }
    }
    private fun closeScreen() { if (isTaskActive()) cancelTask(taskId) else finish() }
    fun isTaskActive(): Boolean = !workflowTerminal && !isFinishing && !isDestroyed

    fun cancelTask(requestedTaskId: String): Boolean {
        if (requestedTaskId != taskId || workflowTerminal) return false
        runOnUiThread {
            workflowTerminal = true
            val updated = repository.cancel(taskId, "操作已取消")
            emit("cancelled", "cancelled", "操作已取消", updated)
            cleanupLoginIfNeeded(); clearJavascriptTask(); deleteTemporaryFile(); finish()
        }
        return true
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        GradeExportCoordinator.detach(this)
        if (!workflowTerminal && ::taskId.isInitialized && ::repository.isInitialized) {
            workflowTerminal = true
            val current = repository.get(taskId)
            if (current?.outcome == "running") {
                if (isFinishing) {
                    val updated = repository.cancel(taskId, "查分页面已关闭")
                    emit("cancelled", "cancelled", "查分页面已关闭", updated)
                } else {
                    val message = if (isChangingConfigurations) "查分页面因界面重建而中断，请重新开始" else "查分页面被系统中断，请重新开始"
                    val updated = repository.interrupt(taskId, "ACTIVITY_RECREATED", message)
                    emit("interrupted", "interrupted", message, updated, "ACTIVITY_RECREATED")
                }
            }
            cleanupLoginIfNeeded(); clearJavascriptTask(); deleteTemporaryFile()
        }
        if (::webView.isInitialized) { webView.stopLoading(); webView.loadUrl("about:blank"); webView.clearHistory(); webView.removeAllViews(); webView.destroy() }
        super.onDestroy()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
    private class IntegrityException : Exception()
    private class SemesterException(val values: Set<String>) : Exception()

    companion object {
        const val EXTRA_TASK_ID = "taskId"
        const val EXTRA_ACADEMIC_YEAR = "academicYear"
        const val EXTRA_SEMESTER = "semester"
        const val EXTRA_KEEP_LOGIN = "keepLoginState"
        private const val BASE_URL = "https://jw.qlu.edu.cn/"
        private const val SCORE_URL_BASE = "https://jw.qlu.edu.cn/jwglxt/cjcx/cjcx_cxDgXscj.html"
        private const val SCORE_URL = "$SCORE_URL_BASE?gnmkdm=N305005&layout=default"
        private const val EXPORT_URL = "https://jw.qlu.edu.cn/jwglxt/cjcx/cjcx_dcXsKccjList.html"
        private const val MAX_FILE_SIZE = 20L * 1024 * 1024
        private const val BASE64_CHUNK_SIZE = 128 * 1024
        private const val ACCESS_TIMEOUT_MS = 60_000L
        private const val EXPORT_TIMEOUT_MS = 120_000L
        private const val POLL_MS = 250L
        private val EXPORT_COLUMNS = listOf("kcmc@课程名称", "xnmmc@学年", "xqmmc@学期", "kkbmmc@开课学院", "kch@课程代码", "jxbmc@教学班", "xf@学分", "xmcj@成绩", "xmblmc@成绩分项")
    }
}
