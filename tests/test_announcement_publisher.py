import importlib.util
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('publisher', 'scripts/publish_announcement.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)

class AnnouncementPublisherTests(unittest.TestCase):
    def test_atomic_upload_and_exact_verification(self):
        commands = []
        def run(command):
            commands.append(command)
            if command[0] == 'scp':
                with open(command[1], encoding='utf-8') as handle:
                    self.assertEqual(json.load(handle)['body'], '第一行\n第二行')
        with patch.object(publisher, 'run', side_effect=run), patch.object(publisher.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='{"id":"test"}')):
            self.assertEqual(publisher.main(['--title','测试','--body',r'第一行\n第二行','--id','test']),0)
        self.assertEqual([c[0] for c in commands], ['scp','ssh'])
        self.assertTrue(commands[0][2].endswith('.tmp'))
        self.assertIn('mv -f --',commands[1][2])
        with patch.object(publisher,'run'), patch.object(publisher.subprocess,'run', return_value=SimpleNamespace(returncode=0,stdout='{"id":"test-old"}')):
            self.assertEqual(publisher.main(['--title','测试','--body','正文','--id','test']),1)

if __name__ == '__main__':
    unittest.main()
