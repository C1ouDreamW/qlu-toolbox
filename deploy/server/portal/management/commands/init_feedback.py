from django.conf import settings
from django.core.management.base import BaseCommand

from feedback.server import init_db


class Command(BaseCommand):
    help = "初始化或补齐现有反馈数据库"

    def handle(self, *args, **options):
        init_db(settings.FEEDBACK_DB)
