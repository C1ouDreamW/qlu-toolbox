package io.github.c1oudreamw.lumatile

import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(GradeExportPlugin::class.java)
        registerPlugin(AppUpdatePlugin::class.java)
        registerPlugin(SchedulePlugin::class.java)
        registerPlugin(CreditReportPlugin::class.java)
        super.onCreate(savedInstanceState)
        installSystemBarInsets()
        lockWebViewTextZoom()
        // 打开应用时同步刷新桌面小组件：覆盖升级不会自动重绘旧组件，这里兜底触发一次
        ScheduleWidgetProvider.requestUpdate(this)
    }

    /**
     * 确定性接管系统栏 insets（capacitor.config.ts 中 SystemBars.insetsHandling=disable）。
     * Android 15+ 因 targetSdk 36 强制 edge-to-edge，系统不再为状态栏和手势条预留空间；
     * Android 15 之前窗口默认不画进系统栏，insets 已被 DecorView 消费，无需补 padding。
     * 传给 WebView 的 safe-area insets 统一清零，网页端 env(safe-area-inset-*) 恒为 0，
     * 布局不再依赖各设备 WebView 版本对 env() 的支持差异。
     */
    private fun installSystemBarInsets() {
        val parent = bridge?.webView?.parent as? ViewGroup ?: return
        ViewCompat.setOnApplyWindowInsetsListener(parent) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val keyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime())
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
                view.setPadding(
                    bars.left,
                    bars.top,
                    bars.right,
                    if (keyboardVisible) ime.bottom else bars.bottom,
                )
            }
            WindowInsetsCompat.Builder(insets)
                .setInsets(
                    WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
                    Insets.of(0, 0, 0, 0),
                )
                .build()
        }
    }

    /** 系统字体缩放会按比例放大 WebView 文字，把固定行高的课表格和顶栏布局撑变形。 */
    private fun lockWebViewTextZoom() {
        bridge?.webView?.settings?.textZoom = 100
    }
}
