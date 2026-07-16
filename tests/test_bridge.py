from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from qlu_toolbox.bridge import Bridge


class BridgeProcessTests(unittest.TestCase):
    def test_macos_browser_download_terminates_the_process_group(self):
        process = Mock(pid=1234)
        process.poll.return_value = None
        with (
            patch("qlu_toolbox.bridge.sys.platform", "darwin"),
            patch(
                "qlu_toolbox.bridge.os.getpgid", return_value=4321, create=True
            ),
            patch("qlu_toolbox.bridge.os.killpg", create=True) as killpg,
        ):
            Bridge._terminate_process_tree(process)
        killpg.assert_called_once_with(4321, signal.SIGTERM)
        process.kill.assert_not_called()


class BridgeIntegrationTests(unittest.TestCase):
    def test_bridge_bootstrap_and_settings_round_trip(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            environment = {
                **os.environ,
                "APPDATA": str(root / "roaming"),
                "LOCALAPPDATA": str(root / "local"),
                "PYTHONUTF8": "1",
            }
            process = subprocess.Popen(
                [sys.executable, "main.py", "--bridge"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                env=environment,
            )
            assert process.stdin is not None and process.stdout is not None
            process.stdin.write(json.dumps({"id": "1", "method": "bootstrap", "params": {}}) + "\n")
            process.stdin.flush()
            bootstrap = json.loads(process.stdout.readline())
            self.assertEqual(bootstrap["channel"], "response")
            self.assertEqual(bootstrap["result"]["tool"]["id"], "grade-export")
            self.assertEqual(
                [tool["id"] for tool in bootstrap["result"]["tools"]],
                ["grade-export", "gpa-calculator"],
            )

            process.stdin.write(json.dumps({"id": "2", "method": "saveSettings", "params": {"theme": "dark"}}) + "\n")
            process.stdin.flush()
            saved = json.loads(process.stdout.readline())
            self.assertEqual(saved["result"]["theme"], "dark")

            browser_dir = Path(bootstrap["result"]["paths"]["browsers"])
            stale_file = browser_dir / "stale-component" / "partial.download"
            stale_file.parent.mkdir(parents=True, exist_ok=True)
            stale_file.write_bytes(b"partial")
            process.stdin.write(json.dumps({"id": "3", "method": "browserComponentStatus", "params": {}}) + "\n")
            process.stdin.flush()
            browser_status = json.loads(process.stdout.readline())
            self.assertTrue(browser_status["result"]["hasFiles"])
            self.assertFalse(browser_status["result"]["installing"])

            process.stdin.write(json.dumps({"id": "4", "method": "removeBrowserComponent", "params": {}}) + "\n")
            process.stdin.flush()
            removed_status = json.loads(process.stdout.readline())
            self.assertFalse(removed_status["result"]["hasFiles"])
            process.stdin.close()
            process.wait(timeout=5)
            process.stdout.close()
            if process.stderr is not None:
                process.stderr.close()
