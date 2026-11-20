import json
from pathlib import Path
from tempfile import TemporaryDirectory

from django.contrib.auth import get_user_model
from django.test import Client, TestCase

from feedback.server import init_db

from .models import Announcement, Operation


class PortalTests(TestCase):
    def setUp(self):
        directory = self.enterContext(TemporaryDirectory())
        self.root = Path(directory)
        feedback = self.root / "feedback.db"
        init_db(feedback)
        self.enterContext(self.settings(FEEDBACK_DB=feedback, UPDATE_DIR=self.root / "updates"))
        self.staff = get_user_model().objects.create_user("maintainer", is_staff=True)

    def test_retired_admin_routes_are_unavailable(self):
        console = Client(HTTP_HOST="console.lumatile.cn")
        self.staff.is_superuser = True
        self.staff.save(update_fields=["is_superuser"])
        self.assertEqual(console.get("/admin/login/", secure=True).status_code, 404)
        console.force_login(self.staff)
        for path in ("/", "/admin", "/admin/", "/admin/login/", "/admin/portal/announcement/", "/stats/"):
            with self.subTest(path=path):
                self.assertEqual(console.get(path, secure=True).status_code, 404)

    def test_feedback_uses_existing_database_and_keeps_public_reads_private(self):
        form = {"type": "bug", "content": "合成反馈", "platform": "android", "appVersion": "2.0.4"}
        api = Client(HTTP_HOST="api.lumatile.cn")
        submission = api.post("/v1/feedback-submissions", form, content_type="application/json", secure=True)
        self.assertEqual(submission.status_code, 201)
        self.assertTrue(submission.headers["Location"].startswith("https://api.lumatile.cn/"))
        resource = submission.headers["Location"].removeprefix("https://api.lumatile.cn")
        self.assertEqual(api.get(resource, secure=True).status_code, 403)
        self.assertEqual(api.get("/v1/feedback-submissions", secure=True).status_code, 403)
        api.force_login(self.staff)
        self.assertEqual(api.get("/v1/feedback-submissions", secure=True).json()["total"], 1)
        invalid = api.get("/v1/feedback-submissions?limit=0", secure=True)
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.headers["Content-Type"], "application/problem+json")
        result = api.patch(resource, {"status": "resolved"}, content_type="application/json", secure=True)
        self.assertEqual(result.json()["status"], "resolved")
        self.assertEqual(Client(HTTP_HOST="lumatile.ishua.cloud").post(
            "/api/feedback", form, content_type="application/json", secure=True,
        ).status_code, 201)

    def test_distribution_defaults_off_and_updates_the_single_nginx_switch(self):
        console = Client(enforce_csrf_checks=True, HTTP_HOST="api.lumatile.cn", HTTP_ORIGIN="https://console.lumatile.cn")
        endpoint = "/v1/distribution-policies/android"
        self.assertEqual(console.get(endpoint, secure=True).status_code, 403)
        console.force_login(self.staff)
        self.assertEqual(console.get(endpoint, secure=True).json()["mode"], "website")
        self.assertEqual(console.put(endpoint, {"mode": "server"}, content_type="application/json", secure=True).status_code, 403)
        token = console.get("/v1/auth/session", secure=True).json()["csrfToken"]
        args = {"content_type": "application/json", "secure": True, "HTTP_X_CSRFTOKEN": token, "HTTP_ORIGIN": "https://console.lumatile.cn"}
        switch = self.root / "updates/android/server.json"
        self.assertEqual(console.put(endpoint, {"mode": "server"}, **args).json()["mode"], "server")
        self.assertEqual(json.loads(switch.read_text())["mode"], "server")
        self.assertEqual(console.put(endpoint, {"mode": "server"}, **args).status_code, 200)
        self.assertEqual(Operation.objects.count(), 1)
        self.assertEqual(console.put(endpoint, {"mode": "website"}, **args).json()["mode"], "website")
        self.assertFalse(switch.exists())

    def test_announcement_publish_is_idempotent_and_can_be_withdrawn(self):
        draft = Announcement.objects.create(title="测试公告", body="合成正文")
        console = Client(HTTP_HOST="api.lumatile.cn")
        console.force_login(self.staff)
        endpoint = "/v1/channels/alpha/active-announcement"
        args = {"content_type": "application/json", "secure": True}
        self.assertEqual(console.put(endpoint, {"draftId": draft.id}, **args).status_code, 201)
        path = self.root / "updates/alpha/announcement.json"
        self.assertEqual(json.loads(path.read_text())["title"], draft.title)
        self.assertEqual(console.put(endpoint, {"draftId": draft.id}, **args).status_code, 200)
        self.assertEqual(Operation.objects.count(), 1)
        self.assertEqual(console.delete(endpoint, secure=True).status_code, 204)
        self.assertFalse(path.exists())
