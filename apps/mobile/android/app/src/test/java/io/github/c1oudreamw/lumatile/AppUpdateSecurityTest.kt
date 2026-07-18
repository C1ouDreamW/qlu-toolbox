package io.github.c1oudreamw.lumatile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdateSecurityTest {
    @Test
    fun acceptsOnlyProjectReleaseUrlsAndKnownRedirectHosts() {
        assertTrue(AppUpdateSecurity.isAllowedDownloadUrl(
            "https://github.com/C1ouDreamW/qlu-toolbox/releases/download/v1.2.3/QLU-Toolbox-Android-v1.2.3.apk",
        ))
        assertTrue(AppUpdateSecurity.isAllowedDownloadUrl(
            "https://github.com/C1ouDreamW/lumatile/releases/download/v2.0.0/LumaTile-Android-v2.0.0.apk",
        ))
        assertTrue(AppUpdateSecurity.isAllowedDownloadUrl(
            "https://release-assets.githubusercontent.com/github-production-release-asset/example",
        ))
        assertFalse(AppUpdateSecurity.isAllowedDownloadUrl(
            "http://github.com/C1ouDreamW/lumatile/releases/download/v2.0.0/update.apk",
        ))
        assertFalse(AppUpdateSecurity.isAllowedDownloadUrl(
            "https://github.com/other/lumatile/releases/download/v2.0.0/update.apk",
        ))
        assertFalse(AppUpdateSecurity.isAllowedDownloadUrl(
            "https://user@github.com/C1ouDreamW/lumatile/releases/download/v2.0.0/update.apk",
        ))
        assertFalse(AppUpdateSecurity.isAllowedDownloadUrl("https://example.com/update.apk"))
    }
}
