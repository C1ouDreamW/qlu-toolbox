package cn.edu.qlu.toolbox

import com.getcapacitor.JSObject
import java.lang.ref.WeakReference

internal object GradeExportCoordinator {
    private var activity = WeakReference<GradeExportActivity>(null)
    private var eventSink: ((JSObject) -> Unit)? = null
    private var expectedLaunchTaskId: String? = null

    @Synchronized fun expectLaunch(taskId: String) { expectedLaunchTaskId = taskId }
    @Synchronized fun consumeExpectedLaunch(taskId: String): Boolean {
        if (expectedLaunchTaskId != taskId) return false
        expectedLaunchTaskId = null
        return true
    }
    @Synchronized fun attach(value: GradeExportActivity) { activity = WeakReference(value) }
    @Synchronized fun detach(value: GradeExportActivity) { if (activity.get() === value) activity.clear() }
    @Synchronized fun setEventSink(sink: (JSObject) -> Unit) { eventSink = sink }
    @Synchronized fun emit(event: JSObject) { eventSink?.invoke(event) }
    @Synchronized fun hasAttachedActivity(): Boolean = activity.get()?.isTaskActive() == true
    @Synchronized fun cancel(taskId: String): Boolean = activity.get()?.cancelTask(taskId) == true
}
