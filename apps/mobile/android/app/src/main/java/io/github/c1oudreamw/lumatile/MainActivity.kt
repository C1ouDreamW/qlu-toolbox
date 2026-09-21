package io.github.c1oudreamw.lumatile

import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import androidx.appcompat.app.AlertDialog
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import com.getcapacitor.BridgeActivity
import kotlin.math.roundToInt

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(GradeExportPlugin::class.java)
        registerPlugin(AppUpdatePlugin::class.java)
        registerPlugin(SchedulePlugin::class.java)
        registerPlugin(CreditReportPlugin::class.java)
        super.onCreate(savedInstanceState)
        if (!ensureSupportedWebView()) return
        enableEdgeToEdge()
        installSystemBarInsets()
        lockWebViewTextZoom()
        // 打开应用时同步刷新桌面小组件：覆盖升级不会自动重绘旧组件，这里兜底触发一次
        ScheduleWidgetProvider.requestUpdate(this)
    }

    private fun ensureSupportedWebView(): Boolean {
        val provider = WebViewCompat.getCurrentWebViewPackage(this)
        val versionName = provider?.versionName
        val major = webViewMajor(versionName)
        Log.i("LumaTileWebView", "provider=${provider?.packageName}, version=$versionName")
        if (major != null && major >= BuildConfig.MIN_WEBVIEW_MAJOR) return true
        bridge?.webView?.stopLoading()
        AlertDialog.Builder(this)
            .setTitle("系统 WebView 版本过低")
            .setMessage("一格有光需要 WebView ${BuildConfig.MIN_WEBVIEW_MAJOR} 或更高版本。请在应用商店更新 Android System WebView 或 Chrome 后重新打开。")
            .setCancelable(false)
            .setPositiveButton("退出应用") { _, _ -> finishAndRemoveTask() }
            .show()
        return false
    }

    /**
     * 确定性接管系统栏 insets（capacitor.config.ts 中 SystemBars.insetsHandling=disable）。
     * WebView 背景铺满系统栏，交互内容通过原生注入的 CSS 安全区变量避让；
     * 横向挖孔继续由容器 padding 兜底，键盘弹出时只保留 IME 底部避让。
     */
    private fun installSystemBarInsets() {
        val parent = bridge?.webView?.parent as? ViewGroup ?: return
        ViewCompat.setOnApplyWindowInsetsListener(parent) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val keyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, 0, bars.right, if (keyboardVisible) ime.bottom else 0)
            injectSafeAreaInsets(bars.top, if (keyboardVisible) 0 else bars.bottom)
            WindowInsetsCompat.Builder(insets)
                .setInsets(
                    WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
                    Insets.of(0, 0, 0, 0),
                )
                .build()
        }
        ViewCompat.requestApplyInsets(parent)
    }

    @Suppress("DEPRECATION")
    private fun enableEdgeToEdge() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
        }
    }

    private fun injectSafeAreaInsets(top: Int, bottom: Int) {
        val density = resources.displayMetrics.density
        val topCssPx = (top / density).roundToInt()
        val bottomCssPx = (bottom / density).roundToInt()
        bridge?.webView?.evaluateJavascript(
            """
            if (document.documentElement) {
              document.documentElement.style.setProperty('--safe-area-inset-top', '${topCssPx}px');
              document.documentElement.style.setProperty('--safe-area-inset-bottom', '${bottomCssPx}px');
            }
            """.trimIndent(),
            null,
        )
    }

    /** 系统字体缩放会按比例放大 WebView 文字，把固定行高的课表格和顶栏布局撑变形。 */
    private fun lockWebViewTextZoom() {
        bridge?.webView?.settings?.textZoom = 100
    }
}
