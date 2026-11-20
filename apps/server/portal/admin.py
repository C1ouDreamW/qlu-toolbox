from django.contrib import admin
from django.utils.html import format_html

from .models import Announcement, Operation

admin.site.site_header = "LumaTile 控制台"
admin.site.site_title = "LumaTile 控制台"
admin.site.index_title = "站点管理"
admin.site.enable_nav_sidebar = False
admin.site.login_template = "portal/login.html"


@admin.register(Announcement)
class AnnouncementAdmin(admin.ModelAdmin):
    list_display = ("title", "level_badge", "expires_at", "id")
    list_filter = ("level",)
    search_fields = ("title", "body")
    search_help_text = "按公告标题或正文搜索"
    ordering = ("-id",)
    fieldsets = (
        ("公告内容", {"fields": ("title", "body")}),
        ("发布选项", {"fields": ("level", "url", "expires_at")}),
    )

    @admin.display(description="级别", ordering="level")
    def level_badge(self, obj):
        return format_html('<span class="admin-badge" data-level="{}">{}</span>', obj.level, obj.get_level_display())


@admin.register(Operation)
class OperationAdmin(admin.ModelAdmin):
    list_display = ("created_at", "actor", "resource", "value")
    readonly_fields = list_display
    ordering = ("-created_at",)
    list_filter = ("created_at", "resource")
    search_fields = ("actor", "resource", "value")
    search_help_text = "按操作者、操作对象或结果搜索"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
