from __future__ import annotations

import importlib.util
import json
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import closing
from pathlib import Path

MODULE_PATH = Path(__file__).parents[1] / "deploy" / "feedback" / "server.py"
SPEC = importlib.util.spec_from_file_location("feedback_server", MODULE_PATH)
assert SPEC and SPEC.loader
feedback_server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(feedback_server)


def valid_feedback() -> dict[str, str]:
    return {
        "type": "bug",
        "content": "课表导入后少了一门课程",
        "contact": "",
        "platform": "android",
        "appVersion": "2.0.0",
        "systemVersion": "Android 15",
    }


class FeedbackServerTests(unittest.TestCase):
    def test_validate_and_save_feedback(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "feedback.db"
            feedback_server.init_db(database)
            value = feedback_server.validate_feedback(valid_feedback())
            feedback_id = feedback_server.save_feedback(value, database)

            self.assertTrue(feedback_id.startswith("FB-"))
            with closing(sqlite3.connect(database)) as connection:
                row = connection.execute(
                    "SELECT type, content, platform, app_version, status FROM feedback WHERE id = ?",
                    (feedback_id,),
                ).fetchone()
            self.assertEqual(row, ("bug", "课表导入后少了一门课程", "android", "2.0.0", "new"))

    def test_rejects_invalid_feedback(self) -> None:
        invalid_values = [
            ("type", "other"),
            ("type", []),
            ("platform", {}),
            ("content", " "),
            ("content", "x" * 2001),
            ("platform", "web"),
            ("appVersion", ""),
            ("contact", "x" * 121),
            ("website", "spam.example"),
        ]
        for field, value in invalid_values:
            with self.subTest(field=field):
                payload = valid_feedback()
                payload[field] = value
                with self.assertRaises(ValueError):
                    feedback_server.validate_feedback(payload)

    def test_rate_limit_expires(self) -> None:
        feedback_server._requests.clear()
        self.assertTrue(all(
            not feedback_server.rate_limited("client", now=float(index)) for index in range(5)
        ))
        self.assertTrue(feedback_server.rate_limited("client", now=5.0))
        self.assertFalse(feedback_server.rate_limited(
            "client", now=feedback_server.RATE_WINDOW_SECONDS + 5.0,
        ))
        feedback_server.rate_limited("another", now=2 * feedback_server.RATE_WINDOW_SECONDS + 10.0)
        self.assertNotIn("client", feedback_server._requests)


class FeedbackAdminTests(unittest.TestCase):
    def make_db(self) -> tuple[str, Path]:
        directory = tempfile.mkdtemp()
        database = Path(directory) / "feedback.db"
        feedback_server.init_db(database)
        return directory, database

    def seed(self, database: Path, content: str = "课表导入后少了一门课程", **overrides: str) -> str:
        value = feedback_server.validate_feedback({
            **valid_feedback(),
            "content": content,
            **overrides,
        })
        return feedback_server.save_feedback(value, database)

    def test_list_filters_counts_and_search(self) -> None:
        _, database = self.make_db()
        bug_id = self.seed(database)
        self.seed(database, content="希望支持深色模式", type="suggestion", platform="desktop",
                  contact="user@example.com")
        self.seed(database, content="桌面端 GPA 计算页面白屏")

        result = feedback_server.list_feedback(path=database)
        self.assertEqual(result["total"], 3)
        self.assertEqual(result["counts"], {"new": 3, "resolved": 0})
        first = result["items"][0]
        self.assertEqual(
            sorted(first.keys()),
            sorted(["id", "type", "content", "contact", "platform",
                    "app_version", "system_version", "status", "created_at"]),
        )
        self.assertEqual(first["status"], "new")

        self.assertEqual(feedback_server.list_feedback(feedback_type="bug", path=database)["total"], 2)
        self.assertEqual(feedback_server.list_feedback(platform="desktop", path=database)["total"], 1)
        self.assertEqual(feedback_server.list_feedback(query="深色", path=database)["total"], 1)
        self.assertEqual(feedback_server.list_feedback(query=bug_id.lower(), path=database)["total"], 1)
        self.assertEqual(feedback_server.list_feedback(query="不存在关键词", path=database)["total"], 0)
        # LIKE 通配符按字面匹配
        self.assertEqual(feedback_server.list_feedback(query="%%", path=database)["total"], 0)

    def test_update_status_flow(self) -> None:
        _, database = self.make_db()
        feedback_id = self.seed(database)

        self.assertTrue(feedback_server.update_feedback_status(feedback_id, "resolved", database))
        result = feedback_server.list_feedback(status="resolved", path=database)
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["counts"], {"new": 0, "resolved": 1})
        self.assertEqual(result["items"][0]["id"], feedback_id)

        # 重开 + 未知编号
        self.assertTrue(feedback_server.update_feedback_status(feedback_id, "new", database))
        self.assertFalse(feedback_server.update_feedback_status("FB-00000000", "resolved", database))
        with self.assertRaises(ValueError):
            feedback_server.update_feedback_status(feedback_id, "archived", database)
        with self.assertRaises(ValueError):
            feedback_server.update_feedback_status("../etc/passwd", "resolved", database)

    def test_database_never_stores_bad_values(self) -> None:
        _, database = self.make_db()
        self.seed(database)
        with closing(sqlite3.connect(database)) as connection:
            row = connection.execute(
                "SELECT status, contact FROM feedback"
            ).fetchone()
        self.assertEqual(row, ("new", ""))


class _QuietFeedbackHandler(feedback_server.FeedbackHandler):
    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        pass


class FeedbackAdminHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        database = Path(self._tmp.name) / "feedback.db"
        feedback_server.init_db(database)
        self._original_db = feedback_server.DB_PATH
        feedback_server.DB_PATH = database
        self.addCleanup(setattr, feedback_server, "DB_PATH", self._original_db)

        self.server = feedback_server.ThreadingHTTPServer(
            ("127.0.0.1", 0), _QuietFeedbackHandler
        )
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def request(self, path: str, *, method: str = "GET", body: dict | None = None,
                admin: bool = True) -> tuple[int, dict | str]:
        headers = {"Content-Type": "application/json"}
        if admin:
            headers["X-Admin-User"] = "admin"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request) as response:
                raw = response.read().decode("utf-8")
                status = response.status
                content_type = response.headers.get("Content-Type", "")
        except urllib.error.HTTPError as error:
            raw = error.read().decode("utf-8")
            status = error.code
            content_type = error.headers.get("Content-Type", "")
        if "application/json" in content_type:
            return status, json.loads(raw)
        return status, raw

    def submit_feedback(self) -> str:
        status, payload = self.request("/api/feedback", method="POST", body=valid_feedback(), admin=False)
        self.assertEqual(status, 201)
        assert isinstance(payload, dict)
        return str(payload["id"])

    def test_admin_requires_gate_header(self) -> None:
        feedback_id = self.submit_feedback()
        for path, method, body in [
            ("/admin/", "GET", None),
            ("/admin/api/feedback", "GET", None),
            ("/admin/api/feedback/status", "POST", {"id": feedback_id, "status": "resolved"}),
        ]:
            with self.subTest(path=path):
                status, payload = self.request(path, method=method, body=body, admin=False)
                self.assertEqual(status, 403)
                self.assertEqual(payload["error"], "无权访问：管理入口需经 Nginx Basic Auth")

    def test_admin_list_page_and_status_flow(self) -> None:
        feedback_id = self.submit_feedback()

        status, page = self.request("/admin/")
        self.assertEqual(status, 200)
        self.assertIn("LumaTile 反馈管理", page)
        self.assertIn("admin/api/feedback", page)

        status, listing = self.request("/admin/api/feedback?status=new&limit=10")
        self.assertEqual(status, 200)
        self.assertEqual(listing["total"], 1)
        self.assertEqual(listing["counts"], {"new": 1, "resolved": 0})
        self.assertEqual(listing["items"][0]["id"], feedback_id)

        status, updated = self.request("/admin/api/feedback/status", method="POST",
                                       body={"id": feedback_id, "status": "resolved"})
        self.assertEqual(status, 200)
        self.assertEqual(updated["ok"], True)

        status, listing = self.request("/admin/api/feedback?status=resolved")
        self.assertEqual(listing["counts"], {"new": 0, "resolved": 1})

        status, payload = self.request("/admin/api/feedback/status", method="POST",
                                       body={"id": "FB-00000000", "status": "resolved"})
        self.assertEqual(status, 404)

        status, payload = self.request("/admin/api/feedback/status", method="POST",
                                       body={"id": feedback_id, "status": "archived"})
        self.assertEqual(status, 400)

    def test_dev_mode_bypasses_gate(self) -> None:
        feedback_server.os.environ["FEEDBACK_DEV_ADMIN"] = "1"
        self.addCleanup(feedback_server.os.environ.pop, "FEEDBACK_DEV_ADMIN", None)
        status, _ = self.request("/admin/api/feedback", admin=False)
        self.assertEqual(status, 200)


if __name__ == "__main__":
    unittest.main()
