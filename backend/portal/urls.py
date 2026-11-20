from django.contrib import admin
from django.urls import path

from . import views

urlpatterns = [
    path("", views.dashboard),
    path("admin/", admin.site.urls),
    path("stats/", views.stats),
    path("healthz", views.health),
    path("api/feedback", views.submit_feedback, {"legacy": True}),
    path("v1/feedback-submissions", views.submit_feedback),
    path("v1/feedback-submissions/<str:item_id>", views.feedback_item),
    path("v1/distribution-policies/android", views.android_distribution),
    path("v1/channels/<str:channel>/active-announcement", views.active_announcement, name="active-announcement"),
]
