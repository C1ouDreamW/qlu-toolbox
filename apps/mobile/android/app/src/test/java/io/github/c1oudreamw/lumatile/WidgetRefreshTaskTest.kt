package io.github.c1oudreamw.lumatile

import java.util.concurrent.Executor
import java.util.concurrent.RejectedExecutionException
import org.junit.Assert.assertEquals
import org.junit.Test

class WidgetRefreshTaskTest {
    @Test
    fun holdsBroadcastUntilQueuedWorkAndNextAlarmAreComplete() {
        val queue = mutableListOf<Runnable>()
        val events = mutableListOf<String>()
        executeWidgetRefresh(Executor { queue.add(it) }, { events.add("finish") }, { throw it }) {
            events.add("read Room")
            events.add("render")
            events.add("schedule alarm")
        }
        assertEquals(emptyList<String>(), events)
        queue.single().run()
        assertEquals(listOf("read Room", "render", "schedule alarm", "finish"), events)
    }

    @Test
    fun finishesAfterEarlyReturnWithNoWidgets() {
        var finished = 0
        executeWidgetRefresh(Executor { it.run() }, { finished++ }, { throw it }) {
            return@executeWidgetRefresh
        }
        assertEquals(1, finished)
    }

    @Test
    fun finishesAfterRefreshFailure() {
        var finished = 0
        val errors = mutableListOf<Exception>()
        val failure = IllegalStateException("Room unavailable")
        executeWidgetRefresh(Executor { it.run() }, { finished++ }, { errors.add(it) }) { throw failure }
        assertEquals(listOf(failure), errors)
        assertEquals(1, finished)
    }

    @Test
    fun finishesWhenExecutorRejectsSubmission() {
        var finished = 0
        var updated = false
        val errors = mutableListOf<Exception>()
        val failure = RejectedExecutionException("executor unavailable")
        executeWidgetRefresh(Executor { throw failure }, { finished++ }, { errors.add(it) }) { updated = true }
        assertEquals(false, updated)
        assertEquals(listOf(failure), errors)
        assertEquals(1, finished)
    }
}
