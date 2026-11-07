from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from lumatile.build_info import load_build_information
from lumatile.core.paths import AppPaths
from lumatile.core.settings import AppSettings


class BuildChannelTests(unittest.TestCase):
    def test_every_private_path_is_isolated_and_stable_data_is_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            roots = {}
            for channel, namespace in [("stable", "QLUToolbox"), ("alpha", "LumaTile-Alpha"), ("debug", "LumaTile-Debug")]:
                with (
                    patch("lumatile.core.paths.Path.home", return_value=home),
                    patch("lumatile.core.paths.sys.platform", "darwin"),
                    patch("lumatile.core.paths.load_build_information", return_value={"dataNamespace": namespace}),
                ):
                    paths = AppPaths.discover()
                paths.ensure()
                roots[channel] = paths.data_dir
                for folder in [paths.config_dir, paths.data_dir, paths.log_dir, paths.profile_dir, paths.browser_dir]:
                    self.assertTrue(folder.is_relative_to(home / "Library" / "Application Support" / namespace))
                (paths.data_dir / "sentinel").write_text(channel)
            self.assertEqual(len(set(roots.values())), 3)
            self.assertEqual((roots["stable"] / "sentinel").read_text(), "stable")

    def test_debug_and_alpha_defaults_do_not_enable_stable_telemetry(self):
        for channel in ["debug", "alpha", "stable"]:
            with self.subTest(channel=channel), patch("lumatile.core.settings.load_build_information", return_value={
                "updatesEnabled": channel != "debug", "telemetryEnabled": channel == "stable",
            }):
                settings = AppSettings()
                self.assertEqual(settings.check_updates, channel != "debug")
                self.assertEqual(settings.anonymous_stats, channel == "stable")

    def test_direct_source_execution_defaults_to_debug_and_ignores_channel_environment_overrides(self):
        with patch("lumatile.build_info.Path.exists", return_value=False), patch.dict("os.environ", {"LUMATILE_BUILD_CHANNEL": "stable"}):
            info = load_build_information()
        self.assertEqual(info["channel"], "debug")
        self.assertEqual(info["dataNamespace"], "LumaTile-Debug")
        self.assertFalse(info["telemetryEnabled"])

    def test_packaged_worker_fails_closed_without_metadata(self):
        with patch("lumatile.build_info.Path.exists", return_value=False), patch("lumatile.build_info.sys.frozen", True, create=True):
            with self.assertRaisesRegex(RuntimeError, "missing"):
                load_build_information()

    def test_worker_rejects_a_debug_build_pointing_to_stable_private_data(self):
        info = {"schemaVersion": 1, "platform": "macos", "channel": "debug", "version": "2.1.0-debug.0",
                "dataNamespace": "QLUToolbox", "applicationId": "student.qlu.toolbox.debug", "updatesEnabled": False, "telemetryEnabled": False, "commit": None}
        with patch("lumatile.build_info.Path.exists", return_value=True), patch("lumatile.build_info.Path.read_text", return_value=json.dumps(info)), patch("lumatile.build_info.__version__", info["version"]):
            with self.assertRaisesRegex(RuntimeError, "namespace"):
                load_build_information()
