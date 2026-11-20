import shutil
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import date
from pathlib import Path
from unittest.mock import Mock, patch

import jobs


class JobsTests(unittest.TestCase):
    def setUp(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.paths = {name: root / name.lower() for name in ("DATA", "UPDATES", "STATS", "LOGS", "BACKUPS")}
        for path in self.paths.values():
            path.mkdir()
        self.enterContext(patch.multiple(jobs, **self.paths))
        self.enterContext(patch.dict("os.environ", {"LUMATILE_ACCESS_LOG_FORMAT": "dated"}))

    def test_collection_keeps_cursor_after_log_is_copied_to_another_host(self):
        path = jobs.LOGS / "lumatile-access-2026-11-20.log"
        entry = '- - - [20/Nov/2026:00:00:00 +0800] "GET /beacon/android?id=test HTTP/1.1" 204 0\n'
        path.write_text(entry)
        jobs.collect_stats(skip_github=True)

        copied = shutil.copyfile(path, path.with_suffix(".copy"))
        copied.replace(path)
        with path.open("a") as output:
            output.write(entry)
        jobs.collect_stats(skip_github=True)

        with closing(sqlite3.connect(jobs.STATS / "stats.db")) as database:
            self.assertEqual(database.execute("SELECT COUNT(*) FROM beacon_hits").fetchone(), (2,))
        self.assertTrue((jobs.STATS / "report/stats.html").is_file())

    def test_backup_snapshots_databases_and_distribution_files(self):
        for path in (jobs.DATA / "portal.db", jobs.DATA / "feedback.db", jobs.STATS / "stats.db"):
            with closing(sqlite3.connect(path)) as database, database:
                database.execute("CREATE TABLE example (item TEXT)")
                database.execute("INSERT INTO example VALUES (?)", (path.name,))
        policy = jobs.UPDATES / "android/server.json"
        policy.parent.mkdir()
        policy.write_text('{"mode":"server"}')

        jobs.backup()

        snapshot, = jobs.BACKUPS.iterdir()
        for name in ("portal.db", "feedback.db", "stats.db"):
            with closing(sqlite3.connect(snapshot / name)) as database:
                self.assertEqual(database.execute("SELECT item FROM example").fetchone(), (name,))
        self.assertEqual((snapshot / "android/server.json").read_text(), policy.read_text())

    def test_host_collection_follows_log_rename_without_recounting(self):
        path = jobs.LOGS / "lumatile.access.log"
        entry = '- - - [20/Nov/2026:00:00:00 +0800] "GET /beacon/desktop?id=host-test HTTP/1.1" 204 0\n'
        path.write_text(entry)
        with patch.dict("os.environ", {"LUMATILE_ACCESS_LOG_FORMAT": "host"}):
            jobs.collect_stats(skip_github=True)
            path.rename(path.with_suffix(".log.1"))
            path.write_text(entry)
            jobs.collect_stats(skip_github=True)

        with closing(sqlite3.connect(jobs.STATS / "stats.db")) as database:
            self.assertEqual(database.execute("SELECT COUNT(*) FROM beacon_hits").fetchone(), (2,))

    def test_scheduled_job_retries_failure_and_records_success(self):
        due = date(2026, 11, 20)
        action = Mock(side_effect=[OSError("test failure"), None])
        with self.assertRaises(OSError):
            jobs.run_job("collect", action, due)
        jobs.run_job("collect", action, due)
        jobs.run_job("collect", action, due)
        self.assertEqual(action.call_count, 2)
