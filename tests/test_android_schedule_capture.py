import base64
import json
from pathlib import Path
from test_schedule_capture_e2e import CONTENT, PAGES, ScheduleCaptureEndToEndTests

class AndroidScheduleCaptureTests(ScheduleCaptureEndToEndTests):
    def test_android_script_captures_native_ajax_and_frames(self):
        from playwright.sync_api import sync_playwright
        source = Path('apps/mobile/android/app/src/main/java/io/github/c1oudreamw/lumatile/ScheduleImportActivity.kt').read_text(encoding='utf-8')
        script = source.split('private fun buildInterceptorScript() = """', 1)[1].split('""".trimIndent()', 1)[0].replace('$MAX_FILE_SIZE',str(20*1024*1024))
        PAGES['/xhr'] = '''<script>setTimeout(()=>{const x=new XMLHttpRequest();x.open('POST','/jwglxt/kbcx/xskbcx_cxDcExcelXskb.html');x.responseType='arraybuffer';x.send('xnm=2026');},600)</script>'''
        PAGES['/request-submit'] = '''<form method="post" action="/jwglxt/kbcx/xskbcx_cxDcExcelXskb.html"></form><script>setTimeout(()=>document.querySelector('form').requestSubmit(),600)</script>'''
        with sync_playwright() as pw:
            try:
                browser = pw.chromium.launch(channel='msedge',headless=True)
            except Exception as error:
                self.skipTest(str(error))
            try:
                for path in ['/', '/native', '/ajax', '/iframe', '/xhr', '/request-submit']:
                    with self.subTest(path=path):
                        page = browser.new_page()
                        requests = []
                        page.on('request', lambda r: requests.append(r.url) if 'cxDcExcel' in r.url else None)
                        page.goto(self.base+path)
                        self.assertTrue(page.evaluate(script))
                        page.wait_for_function('window.__LUMATILE_SCHEDULE_IMPORT__.result', timeout=5000)
                        state = page.evaluate('window.__LUMATILE_SCHEDULE_IMPORT__')
                        self.assertTrue(json.loads(state['result'])['ok'], state['result'])
                        self.assertEqual(base64.b64decode(state['base64']),CONTENT)
                        self.assertEqual(len(requests),1)
                        page.close()
            finally:
                browser.close()
