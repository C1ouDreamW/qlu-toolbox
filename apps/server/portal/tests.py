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

    def test_console_login_and_logout_keep_the_dashboard_protected(self):
        console = Client(enforce_csrf_checks=True, HTTP_HOST="console.lumatile.cn")
        self.assertRedirects(console.get("/", secure=True), "/admin/login/?next=/", fetch_redirect_response=False)
        login = console.get("/admin/login/?next=/", secure=True)
        self.assertContains(login, 'name="next" value="/"')
        self.assertContains(login, '/static/portal/console.css')
        self.assertContains(login, '/static/portal/login.js')
        self.assertContains(login, 'aria-controls="id_password" hidden')
        login_url = "/admin/login/?next=/"
        referer = "https://console.lumatile.cn"
        credentials = {"username": self.staff.username, "password": "local-test-password", "next": "/",
                       "csrfmiddlewaretoken": console.cookies["csrftoken"].value}
        invalid = console.post(login_url, credentials, secure=True, HTTP_REFERER=referer + login_url)
        self.assertContains(invalid, 'role="alert"')
        self.staff.set_password(credentials["password"])
        self.staff.save(update_fields=["password"])
        self.assertRedirects(console.post(login_url, credentials, secure=True, HTTP_REFERER=referer + login_url),
                             "/", fetch_redirect_response=False)
        self.assertContains(console.get("/", secure=True), "运营工作台")
        self.assertEqual(console.post("/admin/logout/", secure=True).status_code, 403)
        token = console.cookies["csrftoken"].value
        logged_out = console.post("/admin/logout/", {"csrfmiddlewaretoken": token}, secure=True,
                                  HTTP_REFERER=referer + "/")
        self.assertContains(logged_out, 'href="/admin/login/?next=/">重新登录')
        self.assertEqual(console.get("/", secure=True).status_code, 302)

    def test_console_admin_lists_keep_permissions_and_support_search(self):
        drafts = "/admin/portal/announcement/"
        operations = "/admin/portal/operation/"
        console = Client(HTTP_HOST="console.lumatile.cn")
        console.force_login(self.staff)
        self.assertEqual(console.get(drafts, secure=True).status_code, 403)
        self.assertEqual(console.get(operations, secure=True).status_code, 403)

        self.staff.is_superuser = True
        self.staff.save(update_fields=["is_superuser"])
        self.assertContains(console.get(drafts, secure=True), "暂无公告草稿")
        draft = Announcement.objects.create(title="维护提醒", body="合成正文", level="warning")
        Announcement.objects.create(title="更新提醒", body="合成正文")
        operation = Operation.objects.create(actor="maintainer", resource="stable-announcement", value="withdrawn")

        results = console.get(drafts, {"q": "提醒", "level__exact": "warning"}, secure=True)
        self.assertContains(results, 'aria-current="page"')
        self.assertContains(results, "/static/portal/console-admin.css")
        self.assertContains(results, "维护提醒")
        self.assertContains(results, 'data-level="warning">重要')
        self.assertNotContains(results, "更新提醒")
        empty = console.get(drafts, {"q": "没有匹配的草稿"}, secure=True)
        self.assertContains(empty, f'href="{drafts}">重置查询')
        for path, title in [("add/", "新建公告草稿"), (f"{draft.pk}/change/", "编辑公告草稿")]:
            form = console.get(drafts + path, secure=True)
            self.assertContains(form, f"<h1>{title}</h1>")
            self.assertContains(form, "发布选项")
            self.assertContains(form, 'href="/#announcement"')
        self.assertContains(console.get(operations, {"q": "withdrawn"}, secure=True), "stable-announcement")
        detail = operations + f"{operation.pk}/change/"
        self.assertContains(console.get(detail, secure=True), "操作时间")
        self.assertEqual(console.post(detail, secure=True).status_code, 403)

    def test_stats_requires_login_and_offers_navigation_without_a_report(self):
        console = Client(HTTP_HOST="console.lumatile.cn")
        self.assertRedirects(console.get("/stats/", secure=True), "/admin/login/?next=/stats/",
                             fetch_redirect_response=False)
        console.force_login(self.staff)
        with self.settings(STATS_DIR=self.root):
            missing = console.get("/stats/", secure=True)
            self.assertContains(missing, "统计报告尚未生成", status_code=404)
            self.assertContains(missing, 'href="/stats/">刷新报告', status_code=404)
            self.assertContains(missing, "返回工作台", status_code=404)
            self.assertEqual(missing.headers["Cache-Control"], "no-store")
            (self.root / "stats.html").write_text("<h1>合成报告</h1>", encoding="utf-8")
            report = console.get("/stats/", secure=True)
            self.assertEqual(report.status_code, 200)
            self.assertEqual(b"".join(report.streaming_content).decode(), "<h1>合成报告</h1>")
            self.assertEqual(report.headers["Cache-Control"], "no-store")

    def test_feedback_uses_existing_database_and_keeps_public_reads_private(self):
        form = {"type": "bug", "content": "合成反馈", "platform": "android", "appVersion": "2.0.4"}
        api = Client(HTTP_HOST="api.lumatile.cn")
        submission = api.post("/v1/feedback-submissions", form, content_type="application/json", secure=True)
        self.assertEqual(submission.status_code, 201)
        resource = submission.headers["Location"].removeprefix("https://console.lumatile.cn")
        console = Client(HTTP_HOST="console.lumatile.cn")
        self.assertEqual(console.get(resource, secure=True).status_code, 403)
        console.force_login(self.staff)
        self.assertEqual(console.get("/v1/feedback-submissions", secure=True).json()["total"], 1)
        invalid = console.get("/v1/feedback-submissions?limit=0", secure=True)
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.headers["Content-Type"], "application/problem+json")
        result = console.patch(resource, {"status": "resolved"}, content_type="application/json", secure=True)
        self.assertEqual(result.json()["status"], "resolved")
        self.assertEqual(Client(HTTP_HOST="lumatile.ishua.cloud").post(
            "/api/feedback", form, content_type="application/json", secure=True,
        ).status_code, 201)

    def test_distribution_defaults_off_and_updates_the_single_nginx_switch(self):
        console = Client(enforce_csrf_checks=True, HTTP_HOST="console.lumatile.cn")
        endpoint = "/v1/distribution-policies/android"
        self.assertEqual(console.get(endpoint, secure=True).status_code, 403)
        console.force_login(self.staff)
        self.assertEqual(console.get(endpoint, secure=True).json()["mode"], "website")
        self.assertEqual(console.put(endpoint, {"mode": "server"}, content_type="application/json", secure=True).status_code, 403)
        console.get("/", secure=True)
        token = console.cookies["csrftoken"].value
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
        console = Client(HTTP_HOST="console.lumatile.cn")
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
