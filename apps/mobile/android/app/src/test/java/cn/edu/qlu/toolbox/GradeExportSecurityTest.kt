package cn.edu.qlu.toolbox

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GradeExportSecurityTest {
    @Test fun allowsOnlyExactHttpsSchoolHosts() {
        assertTrue(GradeExportSecurity.isAllowedUrl("https://jw.qlu.edu.cn/"))
        assertTrue(GradeExportSecurity.isAllowedUrl("https://jw.qlu.edu.cn:443/jwglxt/"))
        assertTrue(GradeExportSecurity.isAllowedUrl("https://sso.qlu.edu.cn/login"))
        assertFalse(GradeExportSecurity.isAllowedUrl("http://jw.qlu.edu.cn/"))
        assertFalse(GradeExportSecurity.isAllowedUrl("https://evil.jw.qlu.edu.cn/"))
        assertFalse(GradeExportSecurity.isAllowedUrl("https://jw.qlu.edu.cn.evil.example/"))
        assertFalse(GradeExportSecurity.isAllowedUrl("https://jw.qlu.edu.cn:444/"))
        assertFalse(GradeExportSecurity.isAllowedUrl("https://user@jw.qlu.edu.cn/"))
        assertFalse(GradeExportSecurity.isAllowedUrl("javascript:alert(1)"))
        assertFalse(GradeExportSecurity.isAllowedUrl(null))
    }

    @Test fun detectsKnownLoggedInRoutesOnlyOnAcademicHost() {
        assertTrue(GradeExportSecurity.isLoggedInUrl("https://jw.qlu.edu.cn/jwglxt/xtgl/index_initMenu.html?jsdm=xs"))
        assertTrue(GradeExportSecurity.isLoggedInUrl("https://jw.qlu.edu.cn/jwglxt/cjcx/test.html"))
        assertFalse(GradeExportSecurity.isLoggedInUrl("https://jw.qlu.edu.cn/"))
        assertFalse(GradeExportSecurity.isLoggedInUrl("https://sso.qlu.edu.cn/jwglxt/cjcx/test.html"))
    }

    @Test fun reportsBlockedHostWithoutEchoingTheWholeUrl() {
        assertEquals("login.example.edu", GradeExportSecurity.blockedHost("https://login.example.edu/path?token=secret"))
        assertEquals("未知地址", GradeExportSecurity.blockedHost("not a url"))
    }
}
