from django.contrib import admin
from django.urls import path

from portal import auth_api, console_api, views

urlpatterns = [
    path("", views.dashboard),
    path("admin/", admin.site.urls),
    path("stats/", views.stats),
    path("healthz", views.health),
    path("api/feedback", views.submit_feedback, {"legacy": True}),
    path("v1/auth/session", auth_api.session),
    path("v1/auth/password", auth_api.password),
    path("v1/overview", console_api.overview),
    path("v1/announcement-drafts", console_api.drafts),
    path("v1/announcement-drafts/<int:draft_id>", console_api.draft_item, name="announcement-draft"),
    path("v1/statistics", console_api.statistics),
    path("v1/operations", console_api.operations),
    path("v1/feedback-submissions", views.submit_feedback),
    path("v1/feedback-submissions/<str:item_id>", views.feedback_item),
    path("v1/distribution-policies/android", views.android_distribution),
    path("v1/channels/<str:channel>/active-announcement", views.active_announcement, name="active-announcement"),
]
