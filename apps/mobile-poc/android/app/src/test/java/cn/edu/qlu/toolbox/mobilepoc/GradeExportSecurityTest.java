package cn.edu.qlu.toolbox.mobilepoc;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class GradeExportSecurityTest {
    @Test
    public void allowsOnlyExactHttpsSchoolHost() {
        assertTrue(GradeExportSecurity.isAllowedUrl("https://jw.qlu.edu.cn/"));
        assertTrue(GradeExportSecurity.isAllowedUrl("https://jw.qlu.edu.cn:443/jwglxt/"));
        assertTrue(GradeExportSecurity.isAllowedUrl("https://sso.qlu.edu.cn/login"));
        assertFalse(GradeExportSecurity.isAllowedUrl("http://jw.qlu.edu.cn/"));
        assertFalse(GradeExportSecurity.isAllowedUrl("https://evil.jw.qlu.edu.cn/"));
        assertFalse(GradeExportSecurity.isAllowedUrl("https://evil.sso.qlu.edu.cn/"));
        assertFalse(GradeExportSecurity.isAllowedUrl("https://jw.qlu.edu.cn.evil.example/"));
        assertFalse(GradeExportSecurity.isAllowedUrl("javascript:alert(1)"));
        assertFalse(GradeExportSecurity.isAllowedUrl("https://user@jw.qlu.edu.cn/"));
    }

    @Test
    public void detectsKnownLoggedInRoutes() {
        assertTrue(GradeExportSecurity.isLoggedInUrl("https://jw.qlu.edu.cn/jwglxt/xtgl/index_initMenu.html?jsdm=xs"));
        assertTrue(GradeExportSecurity.isLoggedInUrl("https://jw.qlu.edu.cn/jwglxt/cjcx/test.html"));
        assertFalse(GradeExportSecurity.isLoggedInUrl("https://jw.qlu.edu.cn/"));
        assertFalse(GradeExportSecurity.isLoggedInUrl("https://sso.qlu.edu.cn/jwglxt/cjcx/test.html"));
        assertFalse(GradeExportSecurity.isLoggedInUrl("https://example.com/jwglxt/cjcx/test.html"));
    }
}
