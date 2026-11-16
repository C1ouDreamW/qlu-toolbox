from django.core.validators import URLValidator
from django.db import models


class Announcement(models.Model):
    title = models.CharField("标题", max_length=120)
    body = models.TextField("正文")
    level = models.CharField("级别", max_length=7, choices=[("info", "普通"), ("warning", "重要")], default="info")
    url = models.URLField("详情链接", blank=True, validators=[URLValidator(schemes=["https"])])
    expires_at = models.DateTimeField("到期时间", blank=True, null=True)

    class Meta:
        verbose_name = "公告草稿"
        verbose_name_plural = "公告草稿"

    def __str__(self):
        return self.title


class Operation(models.Model):
    actor = models.CharField("操作者", max_length=150)
    resource = models.CharField("操作对象", max_length=120)
    value = models.CharField("结果", max_length=120)
    created_at = models.DateTimeField("操作时间", auto_now_add=True)

    class Meta:
        verbose_name = "操作记录"
        verbose_name_plural = "操作记录"

    def __str__(self):
        return f"操作记录 #{self.pk}"
