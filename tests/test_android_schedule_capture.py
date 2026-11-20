import base64
import json
from pathlib import Path
from test_schedule_capture_e2e import CONTENT, PAGES, ScheduleCaptureEndToEndTests

MOBILE = Path(__file__).resolve().parents[1] / 'apps/mobile'


class AndroidScheduleCaptureTests(ScheduleCaptureEndToEndTests):
    def test_android_packages_the_shared_dom_capture(self):
        native_sources = MOBILE / 'android/app/src/main/java/io/github/c1oudreamw/lumatile'
        activity = (native_sources / 'ScheduleImportActivity.kt').read_text(encoding='utf-8')
        plugin = (native_sources / 'SchedulePlugin.kt').read_text(encoding='utf-8')
        gradle = (MOBILE / 'android/app/build.gradle').read_text(encoding='utf-8')
        build_script = (MOBILE / 'scripts/build-webview-assets.mjs').read_text(encoding='utf-8')
        self.assertIn('assets.open("qlu-schedule-dom.js")', activity)
        self.assertIn('SOURCE_QLU_DOM', activity)
        self.assertIn('SOURCE_QLU_DOM', plugin)
        self.assertIn('buildWebViewAssets', gradle)
        self.assertIn('packages/school-web/qlu-schedule-dom.js', gradle)
        self.assertIn('packages/school-web/qlu-schedule-dom.js', build_script)

    def test_android_script_captures_native_ajax_and_frames(self):
        from playwright.sync_api import sync_playwright
        script = (MOBILE / 'webview-scripts/schedule-export-interceptor.js').read_text(encoding='utf-8')
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
                        # 先安装拦截脚本，再推进模拟页面的 600ms 导出定时器，避免慢 CI 抢跑。
                        page.clock.install(time=0)
                        page.clock.pause_at(1000)
                        requests = []
                        page.on('request', lambda r: requests.append(r.url) if 'cxDcExcel' in r.url else None)
                        page.goto(self.base+path)
                        self.assertTrue(page.evaluate(script))
                        page.clock.run_for(600)
                        page.wait_for_function('window.__LUMATILE_SCHEDULE_IMPORT__.result', polling=50, timeout=5000)
                        state = page.evaluate('window.__LUMATILE_SCHEDULE_IMPORT__')
                        self.assertTrue(json.loads(state['result'])['ok'], state['result'])
                        self.assertEqual(base64.b64decode(state['base64']),CONTENT)
                        self.assertEqual(len(requests),1)
                        page.close()
            finally:
                browser.close()
