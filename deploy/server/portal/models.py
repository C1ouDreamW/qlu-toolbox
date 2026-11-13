from django.core.validators import URLValidator
from django.db import models


class Announcement(models.Model):
    title = models.CharField("标题", max_length=120)
    body = models.TextField("正文")
    level = models.CharField("级别", max_length=7, choices=[("info", "普通"), ("warning", "重要")], default="info")
    url = models.URLField("详情链接", blank=True, validators=[URLValidator(schemes=["https"])])
    expires_at = models.DateTimeField("到期时间", blank=True, null=True)

    def __str__(self):
        return self.title


class Operation(models.Model):
    actor = models.CharField(max_length=150)
    resource = models.CharField(max_length=120)
    value = models.CharField(max_length=120)
    created_at = models.DateTimeField(auto_now_add=True)
