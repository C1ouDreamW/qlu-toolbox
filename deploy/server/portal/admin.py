from django.contrib import admin

from .models import Announcement, Operation

admin.site.site_header = "LumaTile 控制台"
admin.site.site_url = "/"


@admin.register(Announcement)
class AnnouncementAdmin(admin.ModelAdmin):
    list_display = ("id", "title", "level", "expires_at")


@admin.register(Operation)
class OperationAdmin(admin.ModelAdmin):
    list_display = ("created_at", "actor", "resource", "value")
    ordering = ("-created_at",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
