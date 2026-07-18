package cn.edu.qlu.toolbox.mobilepoc;

import java.net.URI;
import java.util.Set;

final class GradeExportSecurity {
    static final String ACADEMIC_HOST = "jw.qlu.edu.cn";
    static final String SSO_HOST = "sso.qlu.edu.cn";
    private static final Set<String> ALLOWED_HOSTS = Set.of(ACADEMIC_HOST, SSO_HOST);

    private GradeExportSecurity() {}

    static boolean isAllowedUrl(String rawUrl) {
        try {
            URI uri = URI.create(rawUrl);
            int port = uri.getPort();
            return "https".equalsIgnoreCase(uri.getScheme())
                && uri.getHost() != null
                && ALLOWED_HOSTS.contains(uri.getHost().toLowerCase())
                && uri.getUserInfo() == null
                && (port == -1 || port == 443);
        } catch (IllegalArgumentException error) {
            return false;
        }
    }

    static boolean isLoggedInUrl(String rawUrl) {
        if (!isAllowedUrl(rawUrl)) return false;
        URI uri = URI.create(rawUrl);
        if (!ACADEMIC_HOST.equalsIgnoreCase(uri.getHost())) return false;
        String path = uri.getPath() == null ? "" : uri.getPath();
        String query = uri.getQuery() == null ? "" : uri.getQuery();
        return path.contains("/jwglxt/xtgl/index_initMenu.html")
            || path.contains("/jwglxt/cjcx/")
            || (path.startsWith("/jwglxt/") && query.contains("jsdm=xs"));
    }
}
