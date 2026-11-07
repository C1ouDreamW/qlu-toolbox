package io.github.c1oudreamw.lumatile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import android.content.pm.PackageManager
import org.junit.Test

class AppUpdateSecurityTest {
    @Test
    fun releaseVersionsCannotCrossChannelsOrUseDebugBuilds() {
        assertTrue(AppUpdateSecurity.matchesReleaseVersion("2.1.0", "stable"))
        assertTrue(AppUpdateSecurity.matchesReleaseVersion("2.1.0-alpha.10", "alpha"))
        for (value in listOf("2.1.0", "v2.1.0-alpha.1", "2.1.0-alpha.01", "2.1.0-alpha.0", "2.1.0-debug.0", "2.1.0-alpha.1\n")) {
            assertFalse(AppUpdateSecurity.matchesReleaseVersion(value, "alpha"))
        }
        assertFalse(AppUpdateSecurity.matchesReleaseVersion("2.1.0-alpha.1", "stable"))
        assertFalse(AppUpdateSecurity.matchesReleaseVersion("2.1.0-debug.0", "debug"))
    }

    @Test
    @Suppress("DEPRECATION")
    fun requestsLegacySignaturesBeforeAndroidNine() {
        assertEquals(PackageManager.GET_SIGNATURES, AppUpdateSecurity.signingFlags(26))
        assertEquals(PackageManager.GET_SIGNATURES, AppUpdateSecurity.signingFlags(27))
        assertEquals(PackageManager.GET_SIGNING_CERTIFICATES, AppUpdateSecurity.signingFlags(28))
    }
    @Test
    fun acceptsOnlyProjectReleaseUrlsAndKnownRedirectHosts() {
        assertTrue(AppUpdateSecurity.isAllowedDownloadUrl(
            "https://github.com/C1ouDreamW/qlu-toolbox/releases/download/v1.2.3/QLU-Toolbox-Android-v1.2.3.apk",
        ))
        assertTrue(AppUpdateSecurity.isAllowedDownloadUrl(
            "https://github.com/C1ouDreamW/lumatile/releases/download/v2.0.0/LumaTile-Android-v2.0.0.apk",
        ))
        assertTrue(AppUpdateSecurity.isAllowedDownloadUrl(
            "https://lumatile.ishua.cloud/releases/v2.0.1/LumaTile-Android-v2.0.1.apk",
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
        assertFalse(AppUpdateSecurity.isAllowedDownloadUrl("https://lumatile.ishua.cloud/not-releases/update.apk"))
    }
}
