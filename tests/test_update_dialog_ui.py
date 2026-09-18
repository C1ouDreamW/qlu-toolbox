"""桌面端更新弹窗 Markdown 渲染回归。需先运行 npm run build:renderer。"""
import functools
import http.server
import json
from pathlib import Path
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]

NOTES = (
    '这是以桌面端显示修复为主的版本。\n\n'
    '### 修复\n\n'
    '- 修复桌面端 `深色模式` 启动闪白问题（#8）。\n'
    '- 修复 [问题反馈入口](https://github.com/C1ouDreamW/lumatile/issues) 的样式。\n'
)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class UpdateDialogMarkdownTests(unittest.TestCase):
    def test_update_notes_render_markdown(self):
        if not (ROOT / 'dist-renderer/index.html').exists():
            self.skipTest('Build the renderer before running UI regression tests')
        from playwright.sync_api import sync_playwright
        boot = dict(version='2.0.2', settings=dict(welcome_accepted=True, theme='light', start_page='home',
                    check_updates=True, anonymous_stats=False), schedules=[], tasks=[], tools=[],
                    browserComponent={}, paths={}, metadata={})
        update = dict(version='v2.0.3', name='一格有光 v2.0.3', notes=NOTES,
                      url='https://github.com/C1ouDreamW/lumatile/releases/tag/v2.0.3')
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with sync_playwright() as pw:
                try:
                    browser = pw.chromium.launch(channel='msedge', headless=True)
                except Exception as error:
                    self.skipTest(f'Edge unavailable: {error}')
                page = browser.new_page(viewport={'width': 1200, 'height': 850})
                page.add_init_script('window.auditBoot=' + json.dumps(boot) + ';window.auditUpdate=' + json.dumps(update) + ''';
window.externalCalls=[];window.qlu={onEvent:()=>{},windowAction:()=>{},syncTheme:()=>{},openExternal:async(u)=>{window.externalCalls.push(u)},
checkUpdate:async()=>window.auditUpdate,fetchAnnouncement:async()=>null,sendStatsBeacon:async()=>{},
invoke:async(m)=>{if(m==='bootstrap')return structuredClone(auditBoot);if(m==='listSchedules')return [];if(m==='listTasks')return [];return null}};''')
                page.goto(f'http://127.0.0.1:{server.server_port}/dist-renderer/index.html')
                notes = page.locator('.update-notes')
                notes.locator('.md-heading').first.wait_for()
                self.assertEqual(notes.locator('.md-heading').inner_text(), '修复')
                self.assertEqual(notes.locator('li').count(), 2)
                self.assertEqual(notes.locator('code').inner_text(), '深色模式')
                text = notes.inner_text()
                self.assertNotIn('###', text)
                self.assertNotIn('- 修复', text)
                notes.locator('a').first.click()
                self.assertEqual(page.evaluate('externalCalls'), ['https://github.com/C1ouDreamW/lumatile/issues'])
                browser.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
