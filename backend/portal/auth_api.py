import hashlib
import hmac

from django.conf import settings
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.forms import PasswordChangeForm
from django.middleware.csrf import get_token
from django.views.decorators.debug import sensitive_variables

from feedback.server import rate_limited

from .http import api_errors, methods, payload, problem, response, staff_api


def session_data(request):
    actor = request.user
    staff = actor.is_authenticated and actor.is_active and actor.is_staff
    return {
        "user": actor.get_username() if staff else None,
        "permissions": {
            "addDraft": staff and actor.has_perm("portal.add_announcement"),
            "editDraft": staff and actor.has_perm("portal.change_announcement"),
            "deleteDraft": staff and actor.has_perm("portal.delete_announcement"),
            "viewOperations": staff and (
                actor.has_perm("portal.view_operation") or actor.has_perm("portal.change_operation")
            ),
        },
        "csrfToken": get_token(request),
    }


@api_errors
@sensitive_variables("value", "password")
def session(request):
    unsupported = methods(request, "GET", "POST", "DELETE")
    if unsupported is not None:
        return unsupported
    if request.method == "POST":
        value = payload(request)
        username, password = value.get("username"), value.get("password")
        if (set(value) != {"username", "password"} or not isinstance(username, str)
                or not 1 <= len(username) <= 150 or not isinstance(password, str) or not 1 <= len(password) <= 1024):
            raise ValueError("请填写用户名和密码")
        source = request.headers.get("X-Real-IP") or request.META.get("REMOTE_ADDR", "")
        key = hmac.new(settings.SECRET_KEY.encode(), ("console-login:" + source).encode(), hashlib.sha256).hexdigest()
        if rate_limited(key):
            return problem(429, "rate_limited", "登录请求过多，请稍后再试")
        user = authenticate(request, username=username, password=password)
        if user is None or not user.is_staff:
            return problem(401, "invalid_credentials", "用户名或密码不正确，或账号无维护者权限")
        login(request, user)
    elif request.method == "DELETE":
        logout(request)
    return response(session_data(request))


@staff_api
@sensitive_variables("value", "form")
def password(request):
    unsupported = methods(request, "POST")
    if unsupported is not None:
        return unsupported
    value = payload(request)
    password_fields = {"old_password", "new_password1", "new_password2"}
    if set(value) != password_fields or not all(isinstance(field, str) and len(field) <= 1024 for field in value.values()):
        raise ValueError("请填写当前密码和新密码")
    form = PasswordChangeForm(request.user, value)
    if not form.is_valid():
        return problem(400, "invalid_password", " ".join(message for messages in form.errors.values() for message in messages))
    user = form.save()
    update_session_auth_hash(request, user)
    return response(session_data(request))
