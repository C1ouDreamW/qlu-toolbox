import json
from functools import wraps
from http import HTTPStatus

from django.core.exceptions import RequestDataTooBig, ValidationError
from django.http import JsonResponse
from django.views.csrf import csrf_failure as default_csrf_failure

from feedback.server import MAX_BODY_BYTES


def response(value, status=200, **headers):
    result = JsonResponse(value, status=status, headers=headers)
    result["Cache-Control"] = "no-store"
    return result


def problem(status, code, detail, **headers):
    result = response({"type": "about:blank", "title": HTTPStatus(status).phrase,
                       "status": status, "code": code, "detail": detail}, status, **headers)
    result["Content-Type"] = "application/problem+json"
    return result


def csrf_failure(request, reason=""):
    if request.path.startswith("/v1/"):
        return problem(403, "csrf_failed", "请求缺少有效的 CSRF 凭据")
    return default_csrf_failure(request, reason=reason)


def methods(request, *allowed):
    if request.method not in allowed:
        return problem(405, "method_not_allowed", "此资源不支持该请求方法", Allow=", ".join(allowed))
    return None


def payload(request):
    if request.content_type != "application/json":
        raise ValueError("请求体必须是 JSON")
    try:
        raw = request.body
        if len(raw) > MAX_BODY_BYTES:
            raise RequestDataTooBig()
        value = json.loads(raw)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ValueError("请求体必须是有效 JSON") from error
    if not isinstance(value, dict):
        raise ValueError("请求体必须是 JSON 对象")
    return value


def api_errors(view):
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        try:
            return view(request, *args, **kwargs)
        except RequestDataTooBig:
            return problem(413, "payload_too_large", "请求体过大")
        except (ValueError, ValidationError) as error:
            return problem(400, "invalid_request", str(error))
    return wrapped


def staff_api(view):
    @wraps(view)
    @api_errors
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return problem(403, "session_required", "请先登录")
        if not request.user.is_active or not request.user.is_staff:
            return problem(403, "forbidden", "需要维护者权限")
        return view(request, *args, **kwargs)
    return wrapped
