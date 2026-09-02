package io.github.c1oudreamw.lumatile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScheduleImportSecurityTest {
    @Test
    fun acceptsOnlyTheQluPersonalSchedulePage() {
        assertTrue(ScheduleImportSecurity.isSchedulePage(ScheduleImportSecurity.SCHEDULE_URL))
        assertFalse(ScheduleImportSecurity.isSchedulePage("https://jw.qlu.edu.cn/jwglxt/cjcx/cjcx_cxDgXscj.html"))
        assertFalse(ScheduleImportSecurity.isSchedulePage("https://evil.example/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html"))
    }
}
