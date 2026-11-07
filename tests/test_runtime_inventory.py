"""Exercise the inventory against the installed, locked runtimes used by CI builds."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('runtime_inventory', ROOT / 'scripts/python-runtime-inventory.py')
INVENTORY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INVENTORY)


class RuntimeInventoryTests(unittest.TestCase):
    def test_installed_runtime_graph_and_vendored_notices(self):
        report = INVENTORY.runtime_inventory(ROOT)
        names = {component['name'] for component in report['components']}
        self.assertTrue({'playwright', 'xlrd', 'greenlet', 'pyee', 'typing-extensions', 'pyinstaller', 'CPython', 'Node.js (Playwright driver)'} <= names)
        self.assertNotIn('packaging', names, 'PyInstaller build-only requirements must not be advertised as shipped runtime dependencies')
        references = {component['bom-ref'] for component in report['components']}
        for row in report['dependencies']:
            self.assertIn(row['ref'], references)
            self.assertTrue(set(row['dependsOn']) <= references)
        files = {notice['file'] for notice in report['notices']}
        self.assertIn('playwright/driver/LICENSE', files)
        self.assertTrue(any('ThirdPartyNotices' in file for file in files))
        self.assertTrue(any('COPYING' in file for file in files), 'Keep the PyInstaller bootloader license and exception')
        self.assertNotIn(str(ROOT), str(report))

    def test_unlocked_installed_runtime_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'pyproject.toml').write_text('[project]\ndependencies = ["playwright==1.55.0"]\n', encoding='utf-8')
            (root / 'uv.lock').write_text('package = []\n', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'differs from uv.lock'):
                INVENTORY.runtime_inventory(root)

    def test_unsatisfied_runtime_version_is_rejected(self):
        with patch.object(INVENTORY.metadata, 'version', return_value='0.0.0'):
            with self.assertRaisesRegex(ValueError, 'does not satisfy pyproject.toml'):
                INVENTORY.runtime_inventory(ROOT)
