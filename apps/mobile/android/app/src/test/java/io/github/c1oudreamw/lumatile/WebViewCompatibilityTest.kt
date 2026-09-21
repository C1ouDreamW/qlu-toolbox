package io.github.c1oudreamw.lumatile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WebViewCompatibilityTest {
    @Test
    fun readsChromiumMajorVersion() {
        assertEquals(83, webViewMajor("83.0.4103.101"))
        assertEquals(120, webViewMajor("120.0.6099.230"))
        assertNull(webViewMajor(null))
        assertNull(webViewMajor("unknown"))
    }
}
