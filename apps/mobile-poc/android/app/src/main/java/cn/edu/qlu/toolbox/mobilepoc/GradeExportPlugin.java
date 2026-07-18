package cn.edu.qlu.toolbox.mobilepoc;

import android.content.Intent;
import android.webkit.CookieManager;
import android.webkit.WebStorage;
import android.webkit.WebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.UUID;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "GradeExport")
public class GradeExportPlugin extends Plugin {
    private static final Pattern YEAR = Pattern.compile("20\\d{2}");

    @Override
    public void load() {
        GradeExportCoordinator.setEventSink(event -> getActivity().runOnUiThread(
            () -> notifyListeners("gradeExportEvent", event, true)
        ));
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (GradeExportCoordinator.hasActiveTask()) {
            call.reject("已有查分任务正在进行，请先完成或取消当前任务");
            return;
        }
        String academicYear = call.getString("academicYear", "");
        String semester = call.getString("semester", "");
        boolean keepLoginState = Boolean.TRUE.equals(call.getBoolean("keepLoginState", true));
        if (!YEAR.matcher(academicYear).matches() || !(semester.equals("3") || semester.equals("12"))) {
            call.reject("学年或学期参数无效");
            return;
        }

        String taskId = UUID.randomUUID().toString();
        Intent intent = new Intent(getContext(), GradeExportActivity.class);
        intent.putExtra(GradeExportActivity.EXTRA_TASK_ID, taskId);
        intent.putExtra(GradeExportActivity.EXTRA_ACADEMIC_YEAR, academicYear);
        intent.putExtra(GradeExportActivity.EXTRA_SEMESTER, semester);
        intent.putExtra(GradeExportActivity.EXTRA_KEEP_LOGIN, keepLoginState);
        getActivity().startActivity(intent);

        JSObject result = new JSObject();
        result.put("taskId", taskId);
        call.resolve(result);
    }

    @PluginMethod
    public void continueAfterLogin(PluginCall call) {
        String taskId = call.getString("taskId", "");
        if (!GradeExportCoordinator.continueAfterLogin(taskId)) {
            call.reject("查分页面已关闭或任务不存在");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String taskId = call.getString("taskId", "");
        if (!GradeExportCoordinator.cancel(taskId)) {
            call.reject("查分页面已关闭或任务不存在");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void clearLoginState(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            CookieManager.getInstance().removeAllCookies(ignored -> {
                CookieManager.getInstance().flush();
                WebStorage.getInstance().deleteAllData();
                WebView webView = getBridge().getWebView();
                webView.clearCache(true);
                call.resolve();
            });
        });
    }
}
