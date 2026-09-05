from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from qlu_toolbox.core.settings import AppSettings, SettingsStore

REPO_ROOT = Path(__file__).resolve().parents[1]
_SPEC = importlib.util.spec_from_file_location(
    "update_stats_collect", REPO_ROOT / "deploy" / "stats" / "collect.py"
)
collect = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(collect)


class ParseLogLineTests(unittest.TestCase):
    def test_beacon_line_parses_params_and_day(self):
        line = (
            '1.2.3.4 - - [05/Sep/2026:13:24:01 +0800] '
            '"GET /beacon/desktop?v=2.0.0&os=win32&arch=x64&id=abc-123 HTTP/1.1" 204 0 "-" "LumaTile-Stats"'
        )
        event = collect.parse_log_line(line)
        self.assertEqual(event["kind"], "beacon")
        self.assertEqual(event["day"], "2026-09-05")
        self.assertEqual(event["client"], "desktop")
        self.assertEqual(event["version"], "2.0.0")
        self.assertEqual(event["os"], "win32")
        self.assertEqual(event["arch"], "x64")
        self.assertEqual(event["install_id"], "abc-123")

    def test_beacon_without_id_keeps_event_but_null_id(self):
        line = (
            '1.2.3.4 - - [05/Sep/2026:13:24:01 +0800] '
            '"GET /beacon/android?v=2.0.0&os=android HTTP/1.1" 204 0 "-" "-"'
        )
        event = collect.parse_log_line(line)
        self.assertEqual(event["kind"], "beacon")
        self.assertIsNone(event["install_id"])

    def test_download_line_extracts_tag_and_filename(self):
        line = (
            '5.6.7.8 - - [04/Sep/2026:09:10:00 +0800] '
            '"GET /releases/v2.0.0/LumaTile_v2.0.0_x64_Setup.exe HTTP/1.1" 200 912 "-" "-"'
        )
        event = collect.parse_log_line(line)
        self.assertEqual(event["kind"], "download")
        self.assertEqual(event["tag"], "v2.0.0")
        self.assertEqual(event["filename"], "LumaTile_v2.0.0_x64_Setup.exe")

    def test_manifest_line_counted_for_legacy_clients(self):
        line = (
            '9.9.9.9 - - [04/Sep/2026:09:11:00 +0800] '
            '"GET /stable/desktop.json HTTP/1.1" 200 512 "-" "-"'
        )
        event = collect.parse_log_line(line)
        self.assertEqual(event["kind"], "manifest")
        self.assertEqual(event["client"], "desktop")

    def test_other_paths_and_error_statuses_are_ignored(self):
        kept_out = [
            '9.9.9.9 - - [04/Sep/2026:09:11:00 +0800] "GET /stable/desktop.json HTTP/1.1" 404 0 "-" "-"',
            '9.9.9.9 - - [04/Sep/2026:09:11:00 +0800] "GET /healthz HTTP/1.1" 200 2 "-" "-"',
            '9.9.9.9 - - [04/Sep/2026:09:11:00 +0800] "GET /releases/ HTTP/1.1" 403 0 "-" "-"',
            '这不是一行 nginx 日志',
        ]
        for line in kept_out:
            self.assertIsNone(collect.parse_log_line(line))

    def test_log_time_rejects_bad_month(self):
        self.assertIsNone(collect.parse_log_time("05/Foo/2026:13:24:01 +0800"))


class WatermarkTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.log = self.dir / "access.log"
        self.rolled = self.dir / "access.log.1"
        self.db = self.dir / "stats.db"
        self.conn = collect.init_db(self.db)

    def tearDown(self):
        self.conn.close()
        self._tmp.cleanup()

    def _process(self):
        for path in (self.log, self.rolled):
            collect.process_log_path(self.conn, path)

    def _counts(self):
        beacon = self.conn.execute("SELECT COUNT(*) FROM beacon_hits").fetchone()[0]
        download = self.conn.execute("SELECT COUNT(*) FROM download_hits").fetchone()[0]
        manifest = self.conn.execute("SELECT COALESCE(SUM(count), 0) FROM manifest_checks").fetchone()[0]
        return {"beacon": beacon, "download": download, "manifest": manifest}

    def test_rotation_by_rename_does_not_duplicate_events(self):
        self.log.write_text(
            '1.2.3.4 - - [05/Sep/2026:13:24:01 +0800] '
            '"GET /beacon/desktop?v=2.0.0&os=win32&arch=x64&id=abc HTTP/1.1" 204 0 "-" "-"\n',
            encoding="utf-8",
        )
        self._process()
        self.assertEqual(self._counts(), {"beacon": 1, "download": 0, "manifest": 0})

        # logrotate 的 mv 轮转：文件名变化但 inode 不变，不能重复统计
        self.log.replace(self.rolled)
        self.log.write_text(
            '5.6.7.8 - - [06/Sep/2026:08:00:00 +0800] '
            '"GET /releases/v2.0.0/LumaTile-Android-v2.0.0.apk HTTP/1.1" 206 512 "-" "-"\n',
            encoding="utf-8",
        )
        self._process()
        self.assertEqual(self._counts(), {"beacon": 1, "download": 1, "manifest": 0})

        self._process()
        self.assertEqual(self._counts(), {"beacon": 1, "download": 1, "manifest": 0})

    def test_partial_tail_line_is_held_back_until_complete(self):
        self.log.write_text(
            '1.2.3.4 - - [05/Sep/2026:13:24:01 +0800] '
            '"GET /beacon/desktop?v=2.0.0&os=win32&arch=x64&id=abc HTTP/1.1" 204 0 "-" "-"\n'
            '1.2.3.4 - - [05/Sep/2026:13:25:01 +0800] "GET /beacon/desktop?v=2.0.0',
            encoding="utf-8",
        )
        self._process()
        self.assertEqual(self._counts()["beacon"], 1)

        with self.log.open("a", encoding="utf-8") as handle:
            handle.write('&os=win32&arch=x64&id=abc HTTP/1.1" 204 0 "-" "-"\n')
        self._process()
        self.assertEqual(self._counts()["beacon"], 2)

    def test_report_aggregates_dau_and_downloads(self):
        rows = [
            ("beacon", "2026-09-05", "abc"),
            ("beacon", "2026-09-05", "abc"),
            ("beacon", "2026-09-05", "other"),
            ("beacon", "2026-09-04", "abc"),
            ("download", "2026-09-05", None),
            ("download", "2026-09-04", None),
        ]
        for kind, day, install_id in rows:
            if kind == "beacon":
                self.conn.execute(
                    "INSERT INTO beacon_hits (ts, day, client, version, os, arch, install_id) "
                    "VALUES (?, ?, 'desktop', '2.0.0', 'win32', 'x64', ?)",
                    (f"{day}T12:00:00", day, install_id),
                )
            else:
                self.conn.execute(
                    "INSERT INTO download_hits (ts, day, tag, filename) VALUES (?, ?, 'v2.0.0', 'a.exe')",
                    (f"{day}T12:00:00", day),
                )
        report = collect.collect_report(self.conn, days=30)
        self.assertEqual(report["dau"][-1], 2)  # 09-05 去重后 abc + other
        self.assertEqual(report["dau"][-2], 1)
        self.assertEqual(report["downloads"][-1], 1)
        self.assertEqual(report["totals"]["installs"], 2)


class AnnouncementSchemaTests(unittest.TestCase):
    def test_expired_announcement_shape_is_recognisable(self):
        payload = {
            "schemaVersion": 1,
            "id": "20260905-ab",
            "title": "测试",
            "body": "内容",
            "level": "info",
            "expiresAt": "2020-01-01T00:00:00Z",
        }
        # 与两端客户端一致的判定：schemaVersion/id/title/body 缺一不可
        valid = (
            payload.get("schemaVersion") == 1
            and isinstance(payload.get("id"), str)
            and bool(payload.get("id"))
            and isinstance(payload.get("title"), str)
            and bool(payload.get("title"))
            and isinstance(payload.get("body"), str)
        )
        self.assertTrue(valid)
        self.assertTrue(payload["expiresAt"] < "2026-01-01")


class SettingsAnonymousStatsTests(unittest.TestCase):
    def test_defaults_on_and_persists_off(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = SettingsStore(SimpleNamespace(config_dir=Path(tmp)))
            self.assertTrue(AppSettings().anonymous_stats)
            self.assertTrue(store.load().anonymous_stats)
            settings = store.load()
            settings.anonymous_stats = False
            store.save(settings)
            self.assertFalse(store.load().anonymous_stats)

    def test_legacy_settings_file_without_key_gets_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_dir = Path(tmp)
            (config_dir / "settings.json").write_text(
                json.dumps({"schema_version": 1, "theme": "dark"}), encoding="utf-8"
            )
            store = SettingsStore(SimpleNamespace(config_dir=config_dir))
            loaded = store.load()
            self.assertEqual(loaded.theme, "dark")
            self.assertTrue(loaded.anonymous_stats)


if __name__ == "__main__":
    unittest.main()
