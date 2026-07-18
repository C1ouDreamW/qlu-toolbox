package cn.edu.qlu.toolbox.mobilepoc;

import com.getcapacitor.JSObject;
import java.lang.ref.WeakReference;

final class GradeExportCoordinator {
    interface EventSink { void send(JSObject event); }

    private static EventSink eventSink;
    private static WeakReference<GradeExportActivity> activity = new WeakReference<>(null);

    private GradeExportCoordinator() {}

    static synchronized void setEventSink(EventSink sink) { eventSink = sink; }
    static synchronized void attach(GradeExportActivity value) { activity = new WeakReference<>(value); }
    static synchronized void detach(GradeExportActivity value) {
        if (activity.get() == value) activity.clear();
    }
    static synchronized boolean hasActiveTask() {
        GradeExportActivity value = activity.get();
        return value != null && value.isTaskActive();
    }
    static synchronized void emit(JSObject event) {
        if (eventSink != null) eventSink.send(event);
    }
    static synchronized boolean continueAfterLogin(String taskId) {
        GradeExportActivity value = activity.get();
        return value != null && value.continueAfterLogin(taskId);
    }
    static synchronized boolean cancel(String taskId) {
        GradeExportActivity value = activity.get();
        return value != null && value.cancelTask(taskId);
    }
}
