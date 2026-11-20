from contextlib import closing
from datetime import datetime
from pathlib import Path
import tempfile
import unittest

from stats import collect as stats


class ReleaseRegressionTests(unittest.TestCase):
    def test_statistics_escape_labels_and_keep_manifest_only_days(self):
        with tempfile.TemporaryDirectory() as directory:
            with closing(stats.init_db(Path(directory) / "stats.db")) as conn:
                today = datetime.now().strftime("%Y-%m-%d")
                stats.insert_event(conn, {"kind": "manifest", "day": today})
                report = stats.collect_report(conn)
                self.assertEqual(report["days"], [today])
                self.assertEqual(report["raw_checks"], [1])
        rendered = stats.dist_table("test", [{"label": '<img src=x onerror="alert(1)">', "count": 1}])
        self.assertNotIn("<img", rendered)
        self.assertIn("0%", stats.dist_table("test", [{"label": "new.apk", "count": 0}]))
        for method, status, path in [("HEAD", 200, "a.apk"), ("GET", 301, "a.apk"), ("GET", 200, "SHA256SUMS.txt")]:
            line = f'127.0.0.1 - - [07/Sep/2026:09:00:00 +0800] "{method} /releases/v2/{path} HTTP/1.1" {status} 0'
            self.assertIsNone(stats.parse_log_line(line))

if __name__ == "__main__":
    unittest.main()
