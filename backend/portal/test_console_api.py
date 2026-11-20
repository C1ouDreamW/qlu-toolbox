import json
from pathlib import Path
from tempfile import TemporaryDirectory

from django.contrib.auth import get_user_model
from django.test import Client, TestCase

from feedback.server import init_db

from .models import Announcement, Operation


class ConsoleApiTests(TestCase):
    origin = "https://console.lumatile.cn"
    login_path = "/v1/auth/session"
    drafts_path = "/v1/announcement-drafts"
    password = "local-console-password"
    draft = {"title": "测试公告", "body": "合成正文", "level": "info", "url": "", "expiresAt": None}

    def setUp(self):
        root = Path(self.enterContext(TemporaryDirectory()))
        self.enterContext(self.settings(FEEDBACK_DB=root / "feedback.db", UPDATE_DIR=root / "updates",
                                        STATS_DIR=root, WEBSITE_DIR=root))
        self.root = root
        init_db(root / "feedback.db")
        self.api = Client(enforce_csrf_checks=True, HTTP_HOST="api.lumatile.cn", HTTP_ORIGIN=self.origin)
        self.staff = get_user_model().objects.create_superuser("operator", password=self.password)

    def get(self, path):
        return self.api.get(path, secure=True)

    def request(self, method, path, body=None, **headers):
        token = self.get(self.login_path).json()["csrfToken"]
        return getattr(self.api, method)(path, data=json.dumps(body) if body is not None else "",
                                        content_type="application/json", secure=True,
                                        HTTP_X_CSRFTOKEN=token, **headers)

    def test_session_is_api_host_only_and_requires_csrf(self):
        credentials = {"username": self.staff.username, "password": self.password}
        before = self.get(self.login_path).json()
        self.assertIsNone(before["user"])
        self.assertEqual(self.get("/v1/overview").status_code, 403)
        self.assertEqual(self.api.post(self.login_path, credentials, content_type="application/json",
                                       secure=True).status_code, 403)
        logged_in = self.request("post", self.login_path, credentials)
        self.assertEqual(logged_in.status_code, 200)
        self.assertEqual(logged_in.headers["Access-Control-Allow-Origin"], self.origin)
        self.assertEqual(logged_in.headers["Access-Control-Allow-Credentials"], "true")
        cookie = logged_in.cookies["sessionid"]
        self.assertFalse(cookie["domain"])
        self.assertTrue(cookie["httponly"])
        self.assertTrue(cookie["secure"])
        self.assertEqual(logged_in.json()["user"], "operator")
        stale = self.api.post("/v1/auth/password", {}, content_type="application/json", secure=True,
                              HTTP_X_CSRFTOKEN=before["csrfToken"])
        self.assertEqual(stale.json()["code"], "csrf_failed")
        self.assertEqual(self.get("/v1/overview").status_code, 200)
        self.assertIsNone(self.request("delete", self.login_path).json()["user"])
        self.assertEqual(self.get("/v1/overview").status_code, 403)

    def test_only_console_origin_gets_credentialed_cors(self):
        preflight = self.api.options(self.drafts_path, secure=True, HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
                                     HTTP_ACCESS_CONTROL_REQUEST_HEADERS="content-type,x-csrftoken")
        self.assertEqual(preflight.status_code, 204)
        self.assertEqual(preflight.headers["Access-Control-Allow-Origin"], self.origin)
        self.assertIn("X-CSRFToken", preflight.headers["Access-Control-Allow-Headers"])
        self.assertIn("Origin", preflight.headers["Vary"])
        self.api.force_login(self.staff)
        forbidden = self.request("post", self.drafts_path, self.draft, HTTP_ORIGIN="https://lumatile.cn")
        self.assertEqual(forbidden.json()["code"], "csrf_failed")
        self.assertNotIn("Access-Control-Allow-Origin", forbidden.headers)
        self.assertFalse(Announcement.objects.exists())
        loopback = self.api.options("/v1/feedback-submissions", secure=True, HTTP_ORIGIN="https://localhost",
                                    HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST")
        self.assertEqual(loopback.headers["Access-Control-Allow-Origin"], "https://localhost")
        self.assertNotIn("Access-Control-Allow-Credentials", loopback.headers)

    def test_manage_drafts_and_publish_through_the_api(self):
        self.api.force_login(self.staff)
        created = self.request("post", self.drafts_path, self.draft)
        self.assertEqual(created.status_code, 201)
        draft = created.json()
        item = created.headers["Location"]
        self.assertEqual(self.get(self.drafts_path).json()["items"], [draft])
        edited = self.request("put", item, {**self.draft, "title": "编辑后的公告"})
        self.assertEqual(edited.json()["title"], "编辑后的公告")
        channel = "/v1/channels/stable/active-announcement"
        self.assertEqual(self.request("put", channel, {"draftId": draft["id"]}).status_code, 201)
        self.assertEqual(self.get(channel).json()["title"], "编辑后的公告")
        self.assertEqual(self.request("delete", channel).status_code, 204)
        self.assertEqual(self.request("delete", item).status_code, 204)
        self.assertEqual(self.get(item).status_code, 404)
        self.assertEqual(len(self.get("/v1/operations?q=announcement").json()["items"]), 2)

    def test_staff_permissions_and_private_statistics(self):
        staff = get_user_model().objects.create_user("reader", is_staff=True)
        self.api.force_login(staff)
        self.assertFalse(self.get(self.login_path).json()["permissions"]["addDraft"])
        self.assertEqual(self.request("post", self.drafts_path, self.draft).status_code, 403)
        self.assertEqual(self.get("/v1/operations").status_code, 403)
        self.assertEqual(self.get("/v1/statistics").json()["code"], "report_not_ready")
        (self.root / "stats.json").write_text('{"range_days":30}', encoding="utf-8")
        self.assertEqual(self.get("/v1/statistics").json(), {"range_days": 30})
        (self.root / "desktop-releases.json").write_text('{"mac":{"version":"2.0.4"}}', encoding="utf-8")
        self.assertEqual(self.get("/v1/overview").json()["macos"], "2.0.4")
        self.assertFalse(Operation.objects.exists())

    def test_password_change_keeps_session_active(self):
        self.api.force_login(self.staff)
        new = "updated-console-password"
        result = self.request("post", "/v1/auth/password", {
            "old_password": self.password, "new_password1": new, "new_password2": new,
        })
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.get(self.login_path).json()["user"], "operator")
        self.staff.refresh_from_db()
        self.assertTrue(self.staff.check_password(new))
