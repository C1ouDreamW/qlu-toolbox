package cn.edu.qlu.toolbox.mobilepoc;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;
import java.util.Set;
import org.json.JSONObject;
import org.json.JSONTokener;

public class GradeExportActivity extends AppCompatActivity {
    public static final String EXTRA_TASK_ID = "taskId";
    public static final String EXTRA_ACADEMIC_YEAR = "academicYear";
    public static final String EXTRA_SEMESTER = "semester";
    public static final String EXTRA_KEEP_LOGIN = "keepLoginState";

    private static final String BASE_URL = "https://jw.qlu.edu.cn/";
    private static final String SCORE_URL = "https://jw.qlu.edu.cn/jwglxt/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default";
    private static final String EXPORT_URL = "https://jw.qlu.edu.cn/jwglxt/cjcx/cjcx_dcXsKccjList.html";
    private static final long MAX_FILE_SIZE = 20L * 1024L * 1024L;
    private static final int BASE64_CHUNK_SIZE = 128 * 1024;
    private static final long EXPORT_SCRIPT_TIMEOUT_MS = 120_000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private TextView statusView;
    private ProgressBar progressBar;
    private Button actionButton;
    private String taskId;
    private String academicYear;
    private String semester;
    private boolean keepLoginState;
    private boolean scoreWorkflowStarted;
    private boolean terminalEventSent;
    private boolean firstPageLoaded;
    private File temporaryFile;
    private Uri savedUri;
    private String suggestedName;

    private final Runnable accessTimeout = () -> {
        if (!firstPageLoaded) fail("SCHOOL_UNREACHABLE", "无法访问教务系统。请检查 aTrust、校园网或服务器状态。");
    };

    private final ActivityResultLauncher<Intent> saveDocument = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(),
        result -> {
            if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
                status("awaiting_save", "已取消保存，导出文件仍可再次保存");
                actionButton.setText("重新保存成绩文件");
                actionButton.setVisibility(View.VISIBLE);
                actionButton.setOnClickListener(ignored -> launchSaveDocument());
                return;
            }
            Uri destination = result.getData().getData();
            try (InputStream input = new FileInputStream(temporaryFile);
                 OutputStream output = getContentResolver().openOutputStream(destination, "w")) {
                if (output == null) throw new IOException("系统未提供可写输出流");
                byte[] buffer = new byte[32 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                output.flush();
                savedUri = destination;
                deleteTemporaryFile();
                success();
            } catch (IOException error) {
                fail("SAVE_FAILED", "保存文件失败，请检查目标位置后重试。");
            }
        }
    );

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        taskId = getIntent().getStringExtra(EXTRA_TASK_ID);
        academicYear = getIntent().getStringExtra(EXTRA_ACADEMIC_YEAR);
        semester = getIntent().getStringExtra(EXTRA_SEMESTER);
        keepLoginState = getIntent().getBooleanExtra(EXTRA_KEEP_LOGIN, true);
        if (taskId == null || academicYear == null || semester == null) {
            finish();
            return;
        }
        GradeExportCoordinator.attach(this);
        cleanupStaleTemporaryFiles();
        buildUi();
        configureWebView();
        status("checking_access", "正在连接教务系统…");
        handler.postDelayed(accessTimeout, 60_000);
        webView.loadUrl(BASE_URL);
    }

    private void buildUi() {
        int padding = dp(14);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(247, 249, 248));

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(padding, dp(8), dp(8), dp(8));
        toolbar.setBackgroundColor(Color.rgb(22, 69, 50));
        TextView title = new TextView(this);
        title.setText("学校教务系统 · 安全登录");
        title.setTextColor(Color.WHITE);
        title.setTextSize(16);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        toolbar.addView(title, new LinearLayout.LayoutParams(0, dp(48), 1));
        Button close = new Button(this);
        close.setText("关闭");
        close.setTextColor(Color.WHITE);
        close.setBackgroundColor(Color.TRANSPARENT);
        close.setOnClickListener(ignored -> closeScreen());
        toolbar.addView(close, new LinearLayout.LayoutParams(dp(72), dp(48)));
        root.addView(toolbar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        statusView = new TextView(this);
        statusView.setPadding(padding, dp(10), padding, dp(10));
        statusView.setTextColor(Color.rgb(62, 86, 76));
        statusView.setTextSize(13);
        root.addView(statusView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setIndeterminate(true);
        root.addView(progressBar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));

        webView = new WebView(this);
        root.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        actionButton = new Button(this);
        actionButton.setText("我已完成登录，继续");
        actionButton.setAllCaps(false);
        actionButton.setTextColor(Color.WHITE);
        actionButton.setBackgroundColor(Color.rgb(31, 103, 76));
        actionButton.setVisibility(View.GONE);
        actionButton.setOnClickListener(ignored -> verifyLoginAndContinue(true));
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54));
        buttonParams.setMargins(padding, dp(8), padding, dp(12));
        root.addView(actionButton, buttonParams);
        setContentView(root);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSaveFormData(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new RestrictedClient());
    }

    private final class RestrictedClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleNavigation(request.getUrl().toString(), request.isForMainFrame());
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleNavigation(url, true);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (terminalEventSent) return;
            if (!GradeExportSecurity.isAllowedUrl(url)) return;
            if (!firstPageLoaded) {
                firstPageLoaded = true;
                handler.removeCallbacks(accessTimeout);
            }
            if (url.startsWith("https://jw.qlu.edu.cn/jwglxt/cjcx/cjcx_cxDgXscj.html")) {
                if (!scoreWorkflowStarted) {
                    scoreWorkflowStarted = true;
                    runScoreExport();
                }
                return;
            }
            status("waiting_login", "请在学校页面手动登录，完成后 App 会自动继续");
            actionButton.setVisibility(View.VISIBLE);
            verifyLoginAndContinue(false);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            String code = error.getErrorCode() == ERROR_FAILED_SSL_HANDSHAKE ? "TLS_ERROR" : "SCHOOL_UNREACHABLE";
            fail(code, code.equals("TLS_ERROR") ? "安全连接失败，已拒绝绕过证书校验。" : "无法访问教务系统。请检查 aTrust、校园网或服务器状态。");
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame() && response.getStatusCode() >= 400) {
                fail("SCHOOL_UNREACHABLE", "教务系统返回 HTTP " + response.getStatusCode() + "，请稍后重试。");
            }
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler sslErrorHandler, SslError error) {
            sslErrorHandler.cancel();
            fail("TLS_ERROR", "安全连接失败，已拒绝绕过证书校验。");
        }
    }

    private boolean handleNavigation(String url, boolean mainFrame) {
        if (!mainFrame) return false;
        if (GradeExportSecurity.isAllowedUrl(url)) return false;
        String host = Uri.parse(url).getHost();
        String target = host == null || host.isBlank() ? "未知地址" : host;
        fail("NAVIGATION_BLOCKED", "页面尝试跳转到未确认的域名（" + target + "），已阻止以保护登录状态。");
        return true;
    }

    boolean continueAfterLogin(String requestedTaskId) {
        if (!taskId.equals(requestedTaskId) || terminalEventSent) return false;
        runOnUiThread(() -> verifyLoginAndContinue(true));
        return true;
    }

    boolean isTaskActive() {
        return !terminalEventSent && !isFinishing() && !isDestroyed();
    }

    private void closeScreen() {
        if (terminalEventSent) finish();
        else cancelTask(taskId);
    }

    boolean cancelTask(String requestedTaskId) {
        if (!taskId.equals(requestedTaskId) || terminalEventSent) return false;
        runOnUiThread(() -> {
            terminalEventSent = true;
            emit("cancelled", "cancelled", "操作已取消", null);
            cleanupLoginIfNeeded();
            deleteTemporaryFile();
            finish();
        });
        return true;
    }

    private void verifyLoginAndContinue(boolean manual) {
        if (scoreWorkflowStarted || terminalEventSent) return;
        String currentUrl = webView.getUrl() == null ? "" : webView.getUrl();
        if (GradeExportSecurity.isLoggedInUrl(currentUrl)) {
            openScorePage();
            return;
        }
        webView.evaluateJavascript(
            "(() => Boolean(document.querySelector('#sessionUser') || document.querySelector('#sessionUserKey') || document.querySelector('a[href*=\\\"logout\\\"]')))()",
            result -> {
                if ("true".equals(result) && GradeExportSecurity.isAllowedUrl(webView.getUrl())) openScorePage();
                else if (manual) Toast.makeText(this, "尚未检测到登录成功，请完成登录后再试", Toast.LENGTH_LONG).show();
            }
        );
    }

    private void openScorePage() {
        if (scoreWorkflowStarted || terminalEventSent) return;
        actionButton.setVisibility(View.GONE);
        status("opening_scores", "登录已验证，正在打开成绩查询页…");
        webView.loadUrl(SCORE_URL);
    }

    private void runScoreExport() {
        status("querying", "正在设置学年、学期并查询成绩…");
        webView.evaluateJavascript(buildExportScript(), result -> {
            if (!"true".equals(result)) {
                fail("QUERY_FAILED", "无法启动成绩查询脚本，请重新打开成绩页面后再试。");
                return;
            }
            pollExportResult(SystemClock.elapsedRealtime() + EXPORT_SCRIPT_TIMEOUT_MS);
        });
    }

    private void pollExportResult(long deadline) {
        if (terminalEventSent) return;
        if (SystemClock.elapsedRealtime() >= deadline) {
            fail("QUERY_FAILED", "等待成绩查询或导出响应超时，请检查网络后重试。");
            return;
        }
        webView.evaluateJavascript("window.__QLU_EXPORT_POC_RESULT__", result -> {
            if (terminalEventSent) return;
            if (result == null || "null".equals(result) || "undefined".equals(result)) {
                handler.postDelayed(() -> pollExportResult(deadline), 250);
                return;
            }
            try {
                JSONObject value = parseJavascriptObject(result);
                webView.evaluateJavascript("delete window.__QLU_EXPORT_POC_RESULT__", ignored -> {});
                if (!value.optBoolean("ok")) {
                    fail(value.optString("code", "QUERY_FAILED"), value.optString("message", "成绩查询或导出失败"));
                    return;
                }
                long total = value.getLong("total");
                int base64Length = value.getInt("base64Length");
                if (total <= 0 || total > MAX_FILE_SIZE) {
                    fail("FILE_TOO_LARGE", "导出文件为空或超过 20 MiB 安全限制。");
                    return;
                }
                temporaryFile = new File(getCacheDir(), "grade-export-" + taskId + ".xlsx.part");
                if (temporaryFile.exists() && !temporaryFile.delete()) throw new IOException("无法清理旧临时文件");
                status("downloading", "正在分块传输 Excel 文件…");
                readBase64Chunk(0, base64Length, total, 0L);
            } catch (Exception error) {
                fail("PAGE_CHANGED", "教务系统页面返回了无法识别的结果，页面可能已更新。");
            }
        });
    }

    private String buildExportScript() {
        String columns = "['kcmc@课程名称','xnmmc@学年','xqmmc@学期','kkbmmc@开课学院','kch@课程代码','jxbmc@教学班','xf@学分','xmcj@成绩','xmblmc@成绩分项']";
        return String.format(Locale.ROOT, """
            (() => {
              window.__QLU_EXPORT_POC_RESULT__ = null;
              (async () => {
              try {
                const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
                const until = async (test, timeout) => {
                  const deadline = Date.now() + timeout;
                  while (Date.now() < deadline) { if (test()) return true; await sleep(250); }
                  return false;
                };
                if (!await until(() => document.querySelector('#xnm') && document.querySelector('#xqm'), 30000))
                  return JSON.stringify({ok:false, code:'PAGE_CHANGED', message:'成绩页面缺少学年或学期控件'});
                const year = document.querySelector('#xnm');
                const term = document.querySelector('#xqm');
                if (!await until(() => year.options.length > 1 && term.options.length > 1, 30000))
                  return JSON.stringify({ok:false, code:'PAGE_CHANGED', message:'学年或学期选项加载超时'});
                const schoolYear = '%1$s-' + (Number('%1$s') + 1);
                const yearOption = Array.from(year.options).find(o => o.value === '%1$s' || (o.textContent || '').includes(schoolYear));
                const termNumber = '%2$s' === '3' ? '1' : '2';
                const termName = '%2$s' === '3' ? '第一' : '第二';
                const exactTermOption = Array.from(term.options).find(o => o.value === '%2$s');
                const termNumberPattern = new RegExp(`(^|\\D)${termNumber}(\\D|$)`);
                const termOption = exactTermOption || Array.from(term.options).find(o => {
                  const text = (o.textContent || '').trim();
                  return text.includes(termName) || termNumberPattern.test(text);
                });
                if (!yearOption)
                  return JSON.stringify({ok:false, code:'SEMESTER_MISMATCH', message:'成绩页面中没有 ' + schoolYear + ' 学年'});
                if (!termOption)
                  return JSON.stringify({ok:false, code:'SEMESTER_MISMATCH', message:'成绩页面中没有所选学期'});
                const selectedYear = yearOption.value;
                const selectedTerm = termOption.value;
                year.value = selectedYear;
                term.value = selectedTerm;
                year.dispatchEvent(new Event('change', {bubbles:true}));
                term.dispatchEvent(new Event('change', {bubbles:true}));
                const search = document.querySelector('#search_go');
                if (!search) return JSON.stringify({ok:false, code:'PAGE_CHANGED', message:'成绩页面缺少查询按钮'});
                search.click(); await sleep(800);
                await until(() => !window.jQuery || window.jQuery.active === 0, 15000);
                if (!year || !term || year.value !== selectedYear || term.value !== selectedTerm)
                  return JSON.stringify({ok:false, code:'SEMESTER_MISMATCH', message:'查询后学年或学期发生变化，已拒绝导出'});
                const body = new URLSearchParams();
                body.append('gnmkdmKey', 'N305005'); body.append('xnm', selectedYear);
                body.append('xqm', selectedTerm); body.append('dcclbh', 'JW_N305005_GLY');
                for (const column of %3$s) body.append('exportModel.selectCol', column);
                body.append('exportModel.exportWjgs', 'xls'); body.append('fileName', '成绩单');
                const response = await fetch('%4$s', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'}, body});
                if (!response.ok) return JSON.stringify({ok:false, code:'EXPORT_HTTP_ERROR', message:'教务系统导出失败（HTTP ' + response.status + '）'});
                const bytes = new Uint8Array(await response.arrayBuffer());
                if (!bytes.length || bytes.length > %5$d) return JSON.stringify({ok:false, code:'FILE_TOO_LARGE', message:'导出文件为空或超过安全限制'});
                let binary = '';
                for (let offset = 0; offset < bytes.length; offset += 0x8000)
                  binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
                const base64 = btoa(binary);
                window.__QLU_EXPORT_POC__ = {base64};
                return JSON.stringify({ok:true, total:bytes.length, base64Length:base64.length, contentType:response.headers.get('content-type') || ''});
              } catch (error) {
                return JSON.stringify({ok:false, code:'QUERY_FAILED', message:String(error && error.message || error)});
              }
              })().then(result => { window.__QLU_EXPORT_POC_RESULT__ = result; });
              return true;
            })()
            """, academicYear, semester, columns, EXPORT_URL, MAX_FILE_SIZE);
    }

    private void readBase64Chunk(int offset, int base64Length, long expectedBytes, long writtenBytes) {
        if (terminalEventSent) return;
        if (offset >= base64Length) {
            finishTransfer(expectedBytes, writtenBytes);
            return;
        }
        int end = Math.min(offset + BASE64_CHUNK_SIZE, base64Length);
        String expression = "window.__QLU_EXPORT_POC__.base64.slice(" + offset + "," + end + ")";
        webView.evaluateJavascript(expression, result -> {
            try {
                Object decodedResult = new JSONTokener(result).nextValue();
                if (!(decodedResult instanceof String base64)) throw new IOException("无效分块");
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                try (FileOutputStream output = new FileOutputStream(temporaryFile, true)) { output.write(bytes); }
                long nextWritten = writtenBytes + bytes.length;
                progress(nextWritten, expectedBytes);
                readBase64Chunk(end, base64Length, expectedBytes, nextWritten);
            } catch (Exception error) {
                fail("TRANSFER_FAILED", "Excel 文件分块传输失败，请重新尝试。");
            }
        });
    }

    private void finishTransfer(long expectedBytes, long writtenBytes) {
        webView.evaluateJavascript("delete window.__QLU_EXPORT_POC__", ignored -> {});
        status("validating", "正在校验 XLSX 文件…");
        try {
            if (writtenBytes != expectedBytes || temporaryFile.length() != expectedBytes) throw new IOException("文件长度不一致");
            byte[] magic = new byte[4];
            try (FileInputStream input = new FileInputStream(temporaryFile)) {
                if (input.read(magic) != 4 || magic[0] != 'P' || magic[1] != 'K' || magic[2] != 3 || magic[3] != 4) {
                    throw new IOException("不是 ZIP/XLSX 文件");
                }
            }
            String desiredSemester = semester.equals("3") ? "1" : "2";
            Set<String> actualSemesters;
            try {
                actualSemesters = WorkbookSemesterValidator.readSemesterValues(temporaryFile);
            } catch (IOException error) {
                fail("WORKBOOK_PARSE_FAILED", "Excel 文件已下载，但无法读取其中的学期信息：" + error.getMessage());
                return;
            }
            if (!actualSemesters.contains(desiredSemester)) {
                String actual = actualSemesters.isEmpty() ? "未知" : String.join("、", actualSemesters);
                fail("SEMESTER_MISMATCH", "服务器返回的是第 " + actual + " 学期，与所选第 " + desiredSemester + " 学期不一致，已拒绝保存。");
                return;
            }
            File complete = new File(getCacheDir(), "grade-export-" + taskId + ".xlsx");
            if (complete.exists() && !complete.delete()) throw new IOException("无法替换临时文件");
            if (!temporaryFile.renameTo(complete)) throw new IOException("无法完成临时文件");
            temporaryFile = complete;
            suggestedName = "齐鲁工业大学分项成绩_" + academicYear + "-" + (Integer.parseInt(academicYear) + 1) + "_第" + (semester.equals("3") ? "1" : "2") + "学期.xlsx";
            launchSaveDocument();
        } catch (IOException error) {
            fail("EXPORT_NOT_WORKBOOK", "服务器返回的不是有效 XLSX 文件，登录可能已失效。");
        }
    }

    private void launchSaveDocument() {
        if (temporaryFile == null || !temporaryFile.isFile()) {
            fail("SAVE_FAILED", "临时导出文件已不存在，请重新导出。");
            return;
        }
        status("awaiting_save", "请选择 Excel 文件的保存位置");
        actionButton.setVisibility(View.GONE);
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        intent.putExtra(Intent.EXTRA_TITLE, suggestedName);
        saveDocument.launch(intent);
    }

    private void success() {
        terminalEventSent = true;
        progressBar.setIndeterminate(false);
        progressBar.setProgress(100);
        statusView.setText("保存完成，可交给 WPS 或 Excel 打开验证");
        JSObject extra = new JSObject();
        extra.put("displayName", suggestedName);
        emit("success", "success", "成绩文件已保存", extra);
        cleanupLoginIfNeeded();
        actionButton.setText("用 WPS / Excel 打开");
        actionButton.setVisibility(View.VISIBLE);
        actionButton.setOnClickListener(ignored -> openSavedFile());
    }

    private void openSavedFile() {
        if (savedUri == null) return;
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(savedUri, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(Intent.createChooser(intent, "使用应用打开成绩文件"));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "未找到可打开 XLSX 的应用", Toast.LENGTH_LONG).show();
        }
    }

    private JSONObject parseJavascriptObject(String result) throws Exception {
        Object first = new JSONTokener(result).nextValue();
        if (first instanceof String string) return new JSONObject(string);
        if (first instanceof JSONObject object) return object;
        throw new IllegalArgumentException("unexpected JavaScript result");
    }

    private void status(String stage, String message) {
        if (terminalEventSent) return;
        statusView.setText(message);
        emit("status", stage, message, null);
    }

    private void progress(long loaded, long total) {
        JSObject extra = new JSObject();
        extra.put("loaded", loaded);
        extra.put("total", total);
        emit("transfer_progress", "downloading", "正在传输 Excel 文件…", extra);
    }

    private void fail(String code, String message) {
        if (terminalEventSent) return;
        terminalEventSent = true;
        handler.removeCallbacks(accessTimeout);
        statusView.setText(message);
        progressBar.setVisibility(View.GONE);
        actionButton.setText("关闭并返回");
        actionButton.setVisibility(View.VISIBLE);
        actionButton.setOnClickListener(ignored -> closeScreen());
        JSObject extra = new JSObject();
        extra.put("code", code);
        emit("error", "failed", message, extra);
        cleanupLoginIfNeeded();
        deleteTemporaryFile();
    }

    private void emit(String type, String stage, String message, @Nullable JSObject extra) {
        JSObject event = extra == null ? new JSObject() : extra;
        event.put("type", type);
        event.put("taskId", taskId);
        event.put("stage", stage);
        event.put("message", message);
        GradeExportCoordinator.emit(event);
    }

    private void cleanupLoginIfNeeded() {
        if (keepLoginState) {
            CookieManager.getInstance().flush();
            return;
        }
        CookieManager.getInstance().removeAllCookies(ignored -> CookieManager.getInstance().flush());
        WebStorage.getInstance().deleteAllData();
        if (webView != null) {
            webView.clearCache(true);
            webView.clearHistory();
        }
    }

    private void deleteTemporaryFile() {
        if (temporaryFile != null && temporaryFile.exists()) temporaryFile.delete();
        temporaryFile = null;
    }

    private void cleanupStaleTemporaryFiles() {
        File[] staleFiles = getCacheDir().listFiles((directory, name) -> name.startsWith("grade-export-") && (name.endsWith(".part") || name.endsWith(".xlsx")));
        if (staleFiles == null) return;
        for (File stale : staleFiles) stale.delete();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack() && !scoreWorkflowStarted) webView.goBack();
        else if (!terminalEventSent) cancelTask(taskId);
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        GradeExportCoordinator.detach(this);
        if (webView != null) {
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.clearHistory();
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        if (isFinishing() && !terminalEventSent && taskId != null) {
            terminalEventSent = true;
            emit("cancelled", "cancelled", "查分页面已关闭", null);
            cleanupLoginIfNeeded();
            deleteTemporaryFile();
        }
        super.onDestroy();
    }
}
