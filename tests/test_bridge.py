from __future__ import annotations

import json
import io
import threading
import os
import signal
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from lumatile.bridge import Bridge


# Patch the home directory in the child, too: APPDATA alone does not isolate macOS.
ISOLATED_BRIDGE = """
import sys
from pathlib import Path
from unittest.mock import patch
from main import main

home = Path(sys.argv.pop(1))
with patch("pathlib.Path.home", return_value=home):
    raise SystemExit(main())
"""


class BridgeProcessTests(unittest.TestCase):
    def test_schedule_worker_crash_uses_schedule_event_channel(self):
        bridge = Bridge.__new__(Bridge)
        bridge.tasks, bridge.emit = Mock(), Mock()
        bridge.lock, bridge.worker = threading.Lock(), None
        worker = Mock(stdout=io.StringIO(''), stderr=io.StringIO('crash'))
        worker.wait.return_value = 1
        bridge._read_worker(worker, 'schedule-task', 'scheduleImport')
        self.assertEqual(bridge.emit.call_args.args[0]['name'], 'scheduleImport')

    def test_macos_browser_download_terminates_the_process_group(self):
        process = Mock(pid=1234)
        process.poll.return_value = None
        with (
            patch("lumatile.bridge.sys.platform", "darwin"),
            patch(
                "lumatile.bridge.os.getpgid", return_value=4321, create=True
            ),
            patch("lumatile.bridge.os.killpg", create=True) as killpg,
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
                "XDG_CONFIG_HOME": str(root / "config"),
                "XDG_DATA_HOME": str(root / "data"),
                "PYTHONUTF8": "1",
            }
            process = subprocess.Popen(
                [sys.executable, "-c", ISOLATED_BRIDGE, str(root / "home"), "--bridge"],
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
            self.assertTrue(Path(bootstrap["result"]["paths"]["data"]).is_relative_to(root))
            self.assertEqual(bootstrap["result"]["tool"]["id"], "schedule")
            self.assertEqual(
                [tool["id"] for tool in bootstrap["result"]["tools"]],
                ["schedule", "grade-export", "gpa-calculator", "credit-report"],
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

    def test_bridge_schedule_round_trip(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            environment = {
                **os.environ,
                "APPDATA": str(root / "roaming"),
                "LOCALAPPDATA": str(root / "local"),
                "XDG_CONFIG_HOME": str(root / "config"),
                "XDG_DATA_HOME": str(root / "data"),
                "PYTHONUTF8": "1",
            }
            process = subprocess.Popen(
                [sys.executable, "-c", ISOLATED_BRIDGE, str(root / "home"), "--bridge"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                env=environment,
            )
            assert process.stdin is not None and process.stdout is not None

            def call(request_id: str, method: str, params: dict) -> dict:
                process.stdin.write(json.dumps({"id": request_id, "method": method, "params": params}) + "\n")
                process.stdin.flush()
                return json.loads(process.stdout.readline())

            payload = json.dumps({
                "schemaVersion": 1, "id": "schedule-1", "name": "课表",
                "courses": [{"id": "course-1", "name": "高等数学"}],
            }, ensure_ascii=False)
            saved = call("1", "saveSchedule", {"id": "schedule-1", "name": "2026 课表", "payload": payload, "makeActive": False})
            self.assertEqual(saved["result"]["id"], "schedule-1")
            self.assertTrue(saved["result"]["isActive"])

            listed = call("2", "listSchedules", {})
            self.assertEqual([row["id"] for row in listed["result"]], ["schedule-1"])

            error = call("3", "activateSchedule", {"id": "missing"})
            self.assertIn("课表不存在", error["error"])

            process.stdin.close()
            process.wait(timeout=5)
            process.stdout.close()
            if process.stderr is not None:
                process.stderr.close()
