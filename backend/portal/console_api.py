import json

from django.conf import settings
from django.db.models import Q
from django.forms import ModelForm
from django.http import HttpResponse
from django.urls import reverse

from .http import methods, payload, problem, response, staff_api
from .models import Announcement, Operation


class DraftForm(ModelForm):
    class Meta:
        model = Announcement
        fields = ("title", "body", "level", "url", "expires_at")


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def release_version(path, key=None):
    try:
        value = read_json(path)
        version = value[key]["version"] if key else value["versionName"]
    except (OSError, ValueError, KeyError, TypeError):
        return None
    return version if isinstance(version, str) else None


@staff_api
def overview(request):
    unsupported = methods(request, "GET")
    if unsupported is not None:
        return unsupported
    releases = settings.WEBSITE_DIR / "desktop-releases.json"
    return response({
        "windows": release_version(releases, "windows"),
        "macos": release_version(releases, "mac"),
        "android": {channel: release_version(settings.UPDATE_DIR / channel / "android.json")
                    for channel in ("stable", "alpha")},
    })


def draft_data(draft):
    return {
        "id": draft.pk, "title": draft.title, "body": draft.body, "level": draft.level,
        "url": draft.url, "expiresAt": draft.expires_at.isoformat() if draft.expires_at else None,
    }


def save_draft(request, instance=None):
    value = payload(request)
    required = {"title", "body", "level", "url", "expiresAt"}
    if set(value) != required or not all(isinstance(value[key], str) for key in required - {"expiresAt"}):
        raise ValueError("草稿字段无效")
    if value["expiresAt"] is not None and not isinstance(value["expiresAt"], str):
        raise ValueError("到期时间无效")
    value["expires_at"] = value.pop("expiresAt")
    form = DraftForm(value, instance=instance)
    if not form.is_valid():
        raise ValueError(" ".join(message for messages in form.errors.values() for message in messages))
    return form.save()


@staff_api
def drafts(request):
    unsupported = methods(request, "GET", "POST")
    if unsupported is not None:
        return unsupported
    if request.method == "POST":
        if not request.user.has_perm("portal.add_announcement"):
            return problem(403, "forbidden", "没有新建公告草稿的权限")
        draft = save_draft(request)
        return response(draft_data(draft), 201, Location=reverse("announcement-draft", args=[draft.pk]))
    return response({"items": [draft_data(draft) for draft in Announcement.objects.order_by("-id")]})


@staff_api
def draft_item(request, draft_id):
    unsupported = methods(request, "GET", "PUT", "DELETE")
    if unsupported is not None:
        return unsupported
    permission = {"PUT": "portal.change_announcement", "DELETE": "portal.delete_announcement"}.get(request.method)
    if permission and not request.user.has_perm(permission):
        return problem(403, "forbidden", "没有管理公告草稿的权限")
    draft = Announcement.objects.filter(pk=draft_id).first()
    if draft is None:
        return problem(404, "not_found", "公告草稿不存在")
    if request.method == "DELETE":
        draft.delete()
        return HttpResponse(status=204, headers={"Cache-Control": "no-store"})
    if request.method == "PUT":
        draft = save_draft(request, draft)
    return response(draft_data(draft))


@staff_api
def statistics(request):
    unsupported = methods(request, "GET")
    if unsupported is not None:
        return unsupported
    try:
        report = read_json(settings.STATS_DIR / "stats.json")
    except FileNotFoundError:
        return problem(404, "report_not_ready", "统计报告尚未生成")
    except (OSError, ValueError):
        return problem(503, "report_unavailable", "暂时无法读取统计报告")
    return response(report)


@staff_api
def operations(request):
    unsupported = methods(request, "GET")
    if unsupported is not None:
        return unsupported
    if not (request.user.has_perm("portal.view_operation") or request.user.has_perm("portal.change_operation")):
        return problem(403, "forbidden", "没有查看操作记录的权限")
    offset = int(request.GET.get("offset", "0"))
    query = request.GET.get("q", "").strip()
    if not 0 <= offset <= 2**63 - 51 or len(query) > 120:
        raise ValueError("查询参数无效")
    records = Operation.objects.order_by("-created_at", "-pk")
    if query:
        records = records.filter(Q(actor__icontains=query) | Q(resource__icontains=query) | Q(value__icontains=query))
    rows = list(records.values("actor", "resource", "value", "created_at")[offset:offset + 51])
    return response({"items": rows[:50], "nextOffset": offset + 50 if len(rows) > 50 else None})
