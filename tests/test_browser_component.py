from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from qlu_toolbox.core.browser_component import (
    browser_component_status,
    browser_install_command,
    directory_size,
)
from qlu_toolbox.core.paths import AppPaths


class BrowserComponentTests(unittest.TestCase):
    def test_status_detects_managed_browser_and_size(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = AppPaths(
                root / "config",
                root / "data",
                root / "logs",
                root / "profiles",
                root / "browsers",
            )
            paths.ensure()
            executable = paths.browser_dir / "chromium-1" / "chrome.exe"
            executable.parent.mkdir(parents=True)
            executable.write_bytes(b"browser")
            with (
                patch(
                    "qlu_toolbox.core.browser_component.expected_browser_executable",
                    return_value=executable,
                ),
                patch(
                    "qlu_toolbox.core.browser_component._playwright_browser_metadata",
                    return_value=("1", "100.0"),
                ),
            ):
                status = browser_component_status(paths)
            self.assertTrue(status["installed"])
            self.assertTrue(status["hasFiles"])
            self.assertFalse(status["installing"])
            self.assertEqual(status["version"], "100.0")
            self.assertEqual(status["sizeBytes"], len(b"browser"))

    def test_directory_size_ignores_missing_directory(self):
        self.assertEqual(directory_size(Path("missing-browser-component")), 0)

    def test_installer_skips_headless_shell(self):
        command, _environment = browser_install_command()
        self.assertIn("--no-shell", command)
        self.assertEqual(command[-1], "chromium")


if __name__ == "__main__":
    unittest.main()
