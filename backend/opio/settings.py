import os
from datetime import timedelta
from pathlib import Path
import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent

# Local development: load backend/.env if present. Real environment variables win.
_env_file = BASE_DIR / ".env"
if _env_file.exists():
    for _line in _env_file.read_text(encoding="utf-8-sig").splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _key, _value = _line.split("=", 1)
            os.environ.setdefault(_key.strip(), _value.strip().strip("\"'"))

env = os.environ.get

DEBUG = env("DJANGO_DEBUG", "1") == "1"
SECRET_KEY = env("DJANGO_SECRET_KEY", "dev-only-insecure-key-please-change-me-in-production-0123456789")
if not DEBUG and SECRET_KEY.startswith("dev-only"):
    raise RuntimeError("Set DJANGO_SECRET_KEY for production.")
ALLOWED_HOSTS = [h for h in env("DJANGO_ALLOWED_HOSTS", "*").split(",") if h]
CSRF_TRUSTED_ORIGINS = [o for o in env("CSRF_TRUSTED_ORIGINS", "").split(",") if o]

INSTALLED_APPS = [
    "django.contrib.admin", "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.sessions", "django.contrib.messages", "django.contrib.staticfiles",
    "corsheaders", "rest_framework", "api",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.gzip.GZipMiddleware",          # compress API responses (JSON, photos as data URLs)
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]
ROOT_URLCONF = "opio.urls"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates", "DIRS": [], "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages"]},
}]
WSGI_APPLICATION = "opio.wsgi.application"

# Database: PostgreSQL in production (DATABASE_URL), SQLite for local development.
DATABASES = {"default": dj_database_url.config(
    default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}", conn_max_age=600)}

AUTH_USER_MODEL = "api.User"
AUTH_PASSWORD_VALIDATORS = [{"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"}]
LANGUAGE_CODE = "en-us"
TIME_ZONE = "Africa/Nairobi"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}
MEDIA_URL = "/media/"
MEDIA_ROOT = Path(env("MEDIA_ROOT", str(BASE_DIR / "media")))
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework_simplejwt.authentication.JWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": None,
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"anon": env("ANON_THROTTLE", "120/min")},
}
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=8),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
}

CORS_ALLOWED_ORIGINS = [o for o in env("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",") if o]
CORS_ALLOW_ALL_ORIGINS = DEBUG and env("CORS_ALLOW_ALL", "0") == "1"

GOOGLE_CLIENT_ID = env("GOOGLE_CLIENT_ID", "427816800539-37n2ec4cfut5t75uqs9siuvdv2a7d3lh.apps.googleusercontent.com")

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = env("SECURE_COOKIES", "0") == "1"
    CSRF_COOKIE_SECURE = env("SECURE_COOKIES", "0") == "1"

from corsheaders.defaults import default_headers
CORS_ALLOW_HEADERS = list(default_headers) + ["x-unlock"]

# Until payments are connected, "Upgrade" in the app switches Pro on straight away. Set PRO_SELF_UPGRADE=0 to turn that off
# (then Pro can only be granted by an admin, with the is_pro flag on the user).
PRO_SELF_UPGRADE = env("PRO_SELF_UPGRADE", "1") == "1"
