from __future__ import annotations

import importlib.util
import sqlite3
import tempfile
import unittest
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


if __name__ == "__main__":
    unittest.main()
