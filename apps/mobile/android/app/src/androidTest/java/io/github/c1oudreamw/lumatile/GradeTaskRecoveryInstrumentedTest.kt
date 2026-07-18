package io.github.c1oudreamw.lumatile

import android.content.Intent
import android.os.SystemClock
import android.view.ViewGroup
import android.widget.LinearLayout
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class GradeTaskRecoveryInstrumentedTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val repository = GradeTaskRepository.get(context)

    @Test
    fun coldStartReconciliationInterruptsAnOrphanedRunningTask() {
        val taskId = UUID.randomUUID().toString()
        repository.create(taskId, "2025", "12")

        val recovered = repository.reconcileInterruptedTasks()

        assertNotNull(recovered)
        assertEquals("interrupted", recovered?.stage)
        assertEquals("interrupted", recovered?.outcome)
        assertEquals("TASK_INTERRUPTED", recovered?.errorCode)
        assertEquals("interrupted", repository.get(taskId)?.outcome)
    }

    @Test
    fun activityRecreationDoesNotRestartTheWebViewWorkflow() {
        bringTargetAppToForeground()
        val taskId = UUID.randomUUID().toString()
        repository.create(taskId, "2025", "12")
        val intent = Intent(context, GradeExportActivity::class.java).apply {
            putExtra(GradeExportActivity.EXTRA_TASK_ID, taskId)
            putExtra(GradeExportActivity.EXTRA_ACADEMIC_YEAR, "2025")
            putExtra(GradeExportActivity.EXTRA_SEMESTER, "12")
            putExtra(GradeExportActivity.EXTRA_KEEP_LOGIN, true)
        }
        GradeExportCoordinator.expectLaunch(taskId)

        ActivityScenario.launch<GradeExportActivity>(intent).use { scenario ->
            scenario.recreate()
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            val task = repository.get(taskId)
            assertEquals("interrupted", task?.stage)
            assertEquals("interrupted", task?.outcome)
            assertEquals("ACTIVITY_RECREATED", task?.errorCode)
        }
    }

    @Test
    fun processRestoredIntentWithoutLaunchTicketIsInterrupted() {
        bringTargetAppToForeground()
        val taskId = UUID.randomUUID().toString()
        repository.create(taskId, "2025", "12")
        val intent = Intent(context, GradeExportActivity::class.java).apply {
            putExtra(GradeExportActivity.EXTRA_TASK_ID, taskId)
            putExtra(GradeExportActivity.EXTRA_ACADEMIC_YEAR, "2025")
            putExtra(GradeExportActivity.EXTRA_SEMESTER, "12")
            putExtra(GradeExportActivity.EXTRA_KEEP_LOGIN, true)
        }

        ActivityScenario.launch<GradeExportActivity>(intent).use {
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            val task = repository.get(taskId)
            assertEquals("interrupted", task?.outcome)
            assertEquals("PROCESS_RECREATED", task?.errorCode)
        }
    }

    @Test
    fun toolbarIncludesStatusBarSafeInset() {
        bringTargetAppToForeground()
        val taskId = UUID.randomUUID().toString()
        repository.create(taskId, "2025", "12")
        val intent = Intent(context, GradeExportActivity::class.java).apply {
            putExtra(GradeExportActivity.EXTRA_TASK_ID, taskId)
            putExtra(GradeExportActivity.EXTRA_ACADEMIC_YEAR, "2025")
            putExtra(GradeExportActivity.EXTRA_SEMESTER, "12")
            putExtra(GradeExportActivity.EXTRA_KEEP_LOGIN, true)
        }

        ActivityScenario.launch<GradeExportActivity>(intent).use { scenario ->
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            scenario.onActivity { activity ->
                val content = activity.findViewById<ViewGroup>(android.R.id.content)
                val root = content.getChildAt(0) as LinearLayout
                val toolbar = root.getChildAt(0)
                val statusBarTop = ViewCompat.getRootWindowInsets(root)
                    ?.getInsets(WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.displayCutout())
                    ?.top ?: 0
                val baseTopPadding = (8 * activity.resources.displayMetrics.density + 0.5f).toInt()
                assertEquals(baseTopPadding + statusBarTop, toolbar.paddingTop)
            }
        }
    }

    private fun bringTargetAppToForeground() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val recoveryProbeId = UUID.randomUUID().toString()
        repository.create(recoveryProbeId, "2025", "12")
        instrumentation.uiAutomation
            .executeShellCommand("am start -W -n io.github.c1oudreamw.lumatile/.MainActivity")
            .close()
        instrumentation.waitForIdleSync()

        val deadline = SystemClock.elapsedRealtime() + 5_000
        while (repository.get(recoveryProbeId)?.outcome == "running" && SystemClock.elapsedRealtime() < deadline) {
            SystemClock.sleep(50)
        }
        assertEquals("TASK_INTERRUPTED", repository.get(recoveryProbeId)?.errorCode)
    }
}
