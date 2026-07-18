package io.github.c1oudreamw.lumatile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GradeExportCoordinatorTest {
    @Test
    fun launchTicketCanOnlyBeConsumedOnceByTheMatchingTask() {
        GradeExportCoordinator.expectLaunch("expected-task")

        assertFalse(GradeExportCoordinator.consumeExpectedLaunch("different-task"))
        assertTrue(GradeExportCoordinator.consumeExpectedLaunch("expected-task"))
        assertFalse(GradeExportCoordinator.consumeExpectedLaunch("expected-task"))
    }
}
