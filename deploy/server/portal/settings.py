import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("LUMATILE_DATA_DIR", "/data"))
UPDATE_DIR = Path(os.environ.get("LUMATILE_UPDATE_DIR", "/updates"))
SECRET_KEY = os.environ["LUMATILE_SECRET_KEY"]
DEBUG = False
ALLOWED_HOSTS = os.environ.get(
    "LUMATILE_ALLOWED_HOSTS", "api.lumatile.cn,console.lumatile.cn,lumatile.ishua.cloud"
).split(",")
ROOT_URLCONF = "portal.urls"
WSGI_APPLICATION = "portal.wsgi.application"
INSTALLED_APPS = [
    "django.contrib.admin", "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.sessions", "django.contrib.messages", "django.contrib.staticfiles", "portal",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware", "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware", "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware", "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request", "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": DATA_DIR / "portal.db"}}
DEFAULT_AUTO_FIELD = "django.db.models.AutoField"
FEEDBACK_DB = DATA_DIR / "feedback.db"
STATS_DIR = Path(os.environ.get("LUMATILE_STATS_DIR", "/stats"))
WEBSITE_DIR = Path(os.environ.get("LUMATILE_WEBSITE_DIR", "/website/current"))
FEEDBACK_ORIGINS = {"https://localhost", "http://localhost"}
DATA_UPLOAD_MAX_MEMORY_SIZE = 8192
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = True
SECURE_REDIRECT_EXEMPT = [r"^healthz$"]
SECURE_HSTS_SECONDS = 31536000
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
CSRF_FAILURE_VIEW = "portal.views.csrf_failure"
LANGUAGE_CODE = "zh-hans"
TIME_ZONE = "Asia/Shanghai"
STATIC_URL = "/static/"
STATIC_ROOT = Path(os.environ.get("LUMATILE_STATIC_DIR", "/static"))
LOGIN_URL = "/admin/login/"
