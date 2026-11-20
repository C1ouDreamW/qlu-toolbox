import hashlib
import hmac
import json
import sqlite3
from contextlib import closing
from urllib.parse import urlencode

from django.conf import settings
from django.core.exceptions import RequestDataTooBig
from django.db import DatabaseError
from django.http import HttpResponse
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from feedback.server import (
    ADMIN_STATUSES, FEEDBACK_ID_RE, list_feedback, rate_limited,
    save_feedback, update_feedback_status, validate_feedback,
)

from .http import methods, payload, problem, response, staff_api
from .models import Announcement, Operation
from .publication import DOWNLOAD_URL, distribution_policy, policy_path, write_json


def cors(request, result):
    origin = request.headers.get("Origin")
    if origin in settings.FEEDBACK_ORIGINS:
        result["Access-Control-Allow-Origin"] = origin
        result["Access-Control-Allow-Headers"] = "Content-Type"
        result["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    result["Vary"] = "Origin"
    return result


@csrf_exempt
def submit_feedback(request, legacy=False):
    if not legacy and (request.method == "GET" or request.get_host() == "console.lumatile.cn"):
        # Console collection is read-only. Writes use the CSRF-protected item resource.
        return feedback_collection(request)

    def error(status, code, detail):
        return response({"error": detail}, status) if legacy else problem(status, code, detail)

    if request.method == "OPTIONS":
        return cors(request, HttpResponse(status=204))
    unsupported = methods(request, "POST", "OPTIONS")
    if unsupported is not None:
        return cors(request, unsupported)
    source = request.headers.get("X-Real-IP") or request.META.get("REMOTE_ADDR", "")
    rate_key = hmac.new(settings.SECRET_KEY.encode(), source.encode(), hashlib.sha256).hexdigest()
    if rate_limited(rate_key):
        return cors(request, error(429, "rate_limited", "提交过于频繁，请稍后再试"))
    try:
        item = validate_feedback(payload(request))
        item_id = save_feedback(item, settings.FEEDBACK_DB)
    except RequestDataTooBig:
        result = error(413, "payload_too_large", "请求体过大")
    except ValueError as exc:
        result = error(400, "invalid_feedback", str(exc))
    except (sqlite3.Error, RuntimeError):
        result = error(503, "feedback_unavailable", "暂时无法保存反馈，请稍后再试")
    else:
        result = response({"id": item_id}, 201)
        if not legacy:
            result["Location"] = f"https://api.lumatile.cn/v1/feedback-submissions/{item_id}"
    return cors(request, result)


def feedback_resource(item_id):
    if not FEEDBACK_ID_RE.fullmatch(item_id):
        return None
    with closing(sqlite3.connect(settings.FEEDBACK_DB)) as connection:
        connection.row_factory = sqlite3.Row
        item = connection.execute("SELECT * FROM feedback WHERE id = ?", (item_id,)).fetchone()
        return dict(item) if item else None


@staff_api
def feedback_collection(request):
    unsupported = methods(request, "GET")
    if unsupported is not None:
        return unsupported
    filters = request.GET
    limit = int(filters.get("limit", "50"))
    offset = int(filters.get("offset", "0"))
    if not 1 <= limit <= 200 or not 0 <= offset <= 2**63 - 1:
        raise ValueError("分页参数无效")
    result = list_feedback(filters.get("status", "all"), filters.get("type", ""), filters.get("platform", ""),
                           filters.get("q", ""), limit, offset, settings.FEEDBACK_DB)
    parameters = {**filters.dict(), "limit": limit}
    result["links"] = {
        "self": request.path + "?" + urlencode({**parameters, "offset": offset}),
        "next": request.path + "?" + urlencode({**parameters, "offset": offset + limit}) if offset + limit < result["total"] else None,
        "previous": request.path + "?" + urlencode({**parameters, "offset": max(0, offset - limit)}) if offset else None,
    }
    return response(result)


@staff_api
def feedback_item(request, item_id):
    unsupported = methods(request, "GET", "PATCH")
    if unsupported is not None:
        return unsupported
    if request.method == "PATCH":
        value = payload(request)
        status = value.get("status")
        if set(value) != {"status"} or not isinstance(status, str) or status not in ADMIN_STATUSES:
            raise ValueError("状态取值无效")
        if not FEEDBACK_ID_RE.fullmatch(item_id) or not update_feedback_status(item_id, status, settings.FEEDBACK_DB):
            return problem(404, "not_found", "反馈不存在")
    item = feedback_resource(item_id)
    return response(item) if item else problem(404, "not_found", "反馈不存在")


@staff_api
def android_distribution(request):
    unsupported = methods(request, "GET", "PUT")
    if unsupported is not None:
        return unsupported
    if request.method == "PUT":
        value = payload(request)
        mode = value.get("mode")
        if set(value) != {"mode"} or mode not in ("server", "website"):
            raise ValueError("分发模式必须是 server 或 website")
        if mode != distribution_policy()["mode"]:
            if mode == "server":
                write_json(policy_path(), {"mode": mode, "websiteUrl": DOWNLOAD_URL})
            else:
                policy_path().unlink(missing_ok=True)
            Operation.objects.create(actor=request.user.get_username(), resource="android-distribution", value=mode)
    return response(distribution_policy())


@staff_api
def active_announcement(request, channel):
    unsupported = methods(request, "GET", "PUT", "DELETE")
    if unsupported is not None:
        return unsupported
    if channel not in ("stable", "alpha"):
        return problem(404, "not_found", "渠道不存在")
    path = settings.UPDATE_DIR / channel / "announcement.json"
    if request.method == "DELETE":
        if path.exists():
            path.unlink(missing_ok=True)
            Operation.objects.create(actor=request.user.get_username(), resource=f"{channel}-announcement", value="withdrawn")
        return HttpResponse(status=204, headers={"Cache-Control": "no-store"})
    try:
        previous = json.loads(path.read_text())
    except FileNotFoundError:
        previous = None
    if request.method == "GET":
        return response(previous) if previous else problem(404, "not_found", "当前没有公告")
    value = payload(request)
    draft_id = value.get("draftId")
    if set(value) != {"draftId"} or type(draft_id) is not int or draft_id <= 0:
        raise ValueError("需要有效的公告草稿编号")
    draft = Announcement.objects.filter(pk=draft_id).first()
    if draft is None:
        return problem(404, "not_found", "公告草稿不存在")
    draft.full_clean()
    if draft.expires_at and draft.expires_at <= timezone.now():
        raise ValueError("公告已经过期")
    announcement = {"schemaVersion": 1, "title": draft.title, "body": draft.body, "level": draft.level}
    if draft.url:
        announcement["url"] = draft.url
    if draft.expires_at:
        announcement["expiresAt"] = draft.expires_at.isoformat()
    digest = hashlib.sha256(json.dumps(announcement, sort_keys=True).encode()).hexdigest()[:20]
    announcement["id"] = f"{draft_id}-{digest}"
    if previous != announcement:
        write_json(path, announcement)
        Operation.objects.create(actor=request.user.get_username(), resource=f"{channel}-announcement", value=announcement["id"])
    return response(announcement, 200 if previous else 201, Location=reverse("active-announcement", args=[channel]))


def health(request):
    try:
        with closing(sqlite3.connect(f"file:{settings.FEEDBACK_DB}?mode=ro", uri=True)) as database:
            database.execute("SELECT 1 FROM feedback LIMIT 1").fetchone()
        Operation.objects.exists()
    except (sqlite3.Error, DatabaseError):
        return HttpResponse("unavailable\n", status=503)
    return HttpResponse("ok\n", content_type="text/plain", headers={"Cache-Control": "no-store"})
