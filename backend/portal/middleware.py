from django.conf import settings
from django.http import HttpResponse
from django.utils.cache import patch_vary_headers


class ConsoleCorsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not request.path.startswith("/v1/") or request.get_host() != "api.lumatile.cn":
            return self.get_response(request)

        allowed = request.headers.get("Origin") == settings.CONSOLE_ORIGIN
        preflight = allowed and request.method == "OPTIONS" and request.headers.get("Access-Control-Request-Method")
        if preflight:
            result = HttpResponse(status=204)
            result["Access-Control-Allow-Headers"] = "Content-Type, X-CSRFToken"
            result["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        else:
            result = self.get_response(request)
        patch_vary_headers(result, ("Origin",))
        if allowed:
            result["Access-Control-Allow-Origin"] = settings.CONSOLE_ORIGIN
            result["Access-Control-Allow-Credentials"] = "true"
        return result
