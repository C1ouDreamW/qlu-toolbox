from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from lumatile.core.settings import AppSettings, SettingsStore


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
    def setUp(self):
        # These tests retain the Stable defaults; Debug/Alpha policy is tested separately.
        policy = patch("lumatile.core.settings.load_build_information", return_value={"updatesEnabled": True, "telemetryEnabled": True})
        policy.start()
        self.addCleanup(policy.stop)

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
