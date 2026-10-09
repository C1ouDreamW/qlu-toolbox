package io.github.c1oudreamw.lumatile

import java.util.concurrent.Executor
import java.util.concurrent.RejectedExecutionException

/** Completes the broadcast even when work returns early, fails, or cannot be queued. */
internal fun executeWidgetRefresh(
    executor: Executor,
    finish: () -> Unit,
    onError: (Exception) -> Unit,
    update: () -> Unit,
) {
    try {
        executor.execute {
            try {
                update()
            } catch (error: Exception) {
                onError(error)
            } finally {
                finish()
            }
        }
    } catch (error: RejectedExecutionException) {
        try {
            onError(error)
        } finally {
            finish()
        }
    }
}
