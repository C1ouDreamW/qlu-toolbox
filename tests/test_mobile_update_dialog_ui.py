"""Android 更新弹窗的 Markdown 渲染与高度回归。需先运行 npm run mobile:build。"""
import functools
import http.server
import json
from pathlib import Path
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
VIEWPORT = {'width': 390, 'height': 780}

NOTES = '\n'.join([
    '这是以显示修复与兼容性调整为主的修复版本，用较长的更新说明验证弹窗高度不会失控。',
    '',
    '### 修复',
    '',
    '- 修复桌面端深色模式启动时的闪白问题（#8）。',
    '- 修复 `分项成绩导出` 所选学年学期暂无成绩时的误导性报错。',
    '- 修复课表导入时同一单元格多门课被整体丢弃的问题。',
    '- 修复学分统计在真实教务环境读取失败的问题。',
    '- 修复深色模式下多处配色问题。',
    '- 修复公告弹窗眉标显示为英文的问题。',
    '',
    '### 更改',
    '',
    '- 自动检查更新与匿名统计改为胶囊开关。',
    '- 详情见 [Release 页面](https://github.com/C1ouDreamW/lumatile/releases)。',
    '',
])

MANIFEST = {
    'schemaVersion': 1,
    'applicationId': 'io.github.c1oudreamw.lumatile',
    'versionCode': 14,
    'versionName': '2.0.3',
    'channel': 'stable',
    'title': '一格有光版本更新',
    'notes': NOTES,
    'publishedAt': '2026-09-18T00:00:00.000Z',
    'apkUrl': 'https://lumatile.ishua.cloud/releases/v2.0.3/LumaTile-Android-v2.0.3.apk',
    'sha256': 'a' * 64,
    'size': 6408718,
    'mandatory': False,
}

# Capacitor 自定义平台：让浏览器里的移动端构建按 Android 原生环境启动更新检查。
STUB = {
    'localStorage': {
        'scheduleStartPage': 'toolbox',
        'legalNoticeAcceptedVersion': '2026-07-19',
        'autoUpdateCheck': 'true',
        'anonymousStats': 'false',
    },
    'manifest': MANIFEST,
    'headers': [
        {'name': 'AppUpdate', 'methods': [
            {'name': 'getCurrentVersion', 'rtype': 'promise'},
            {'name': 'canInstallPackages', 'rtype': 'promise'},
            {'name': 'openInstallPermissionSettings', 'rtype': 'promise'},
            {'name': 'downloadAndInstall', 'rtype': 'promise'},
            {'name': 'addListener', 'rtype': 'callback'},
        ]},
        {'name': 'GradeExport', 'methods': [
            {'name': 'getActiveTask', 'rtype': 'promise'},
            {'name': 'listTasks', 'rtype': 'promise'},
            {'name': 'addListener', 'rtype': 'callback'},
            {'name': 'removeAllListeners', 'rtype': 'promise'},
        ]},
    ],
    'native': {
        'AppUpdate': {'getCurrentVersion': {
            'applicationId': 'io.github.c1oudreamw.lumatile', 'versionCode': 13, 'versionName': '2.0.2',
        }},
        'GradeExport': {'getActiveTask': {'task': None}, 'listTasks': {'tasks': []}},
    },
}

INIT_SCRIPT = 'window.__stub=' + json.dumps(STUB) + ''';const s=window.__stub;
for (const [key, value] of Object.entries(s.localStorage)) localStorage.setItem(key, value);
window.CapacitorCustomPlatform={name:'android'};
window.Capacitor={PluginHeaders:s.headers,
  nativePromise:(plugin,method)=>Promise.resolve(((s.native[plugin]||{})[method])??{}),
  nativeCallback:()=>1};
window.fetch=async(url)=>{const target=String(url);
  if(target.includes('android.json'))return new Response(JSON.stringify(s.manifest),{status:200,headers:{'Content-Type':'application/json'}});
  if(target.includes('announcement.json'))return new Response('',{status:404});
  return new Response('{}',{status:200,headers:{'Content-Type':'application/json'}})};'''


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class MobileUpdateDialogTests(unittest.TestCase):
    def test_update_notes_render_markdown_without_filling_the_screen(self):
        if not (ROOT / 'apps/mobile/dist/index.html').exists():
            self.skipTest('Build the mobile renderer before running UI regression tests')
        from playwright.sync_api import sync_playwright
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with sync_playwright() as pw:
                try:
                    browser = pw.chromium.launch(channel='msedge', headless=True)
                except Exception as error:
                    self.skipTest(f'Edge unavailable: {error}')
                page = browser.new_page(viewport=VIEWPORT)
                page.add_init_script(INIT_SCRIPT)
                page.goto(f'http://127.0.0.1:{server.server_port}/apps/mobile/dist/index.html')
                notes = page.locator('.update-notes')
                notes.locator('.md-heading').first.wait_for()
                self.assertEqual(notes.locator('.md-heading').count(), 2)
                self.assertEqual(notes.locator('li').count(), 8)
                self.assertEqual(notes.locator('code').first.inner_text(), '分项成绩导出')
                text = notes.inner_text()
                self.assertNotIn('###', text)
                self.assertNotIn('- 修复', text)
                self.assertIn('Release 页面', text)
                # 移动端更新说明里的链接只展示文字，不打开外部浏览器。
                self.assertEqual(page.locator('.update-notes a').count(), 0)
                notes_box = notes.bounding_box()
                dialog_box = page.locator('.update-dialog').bounding_box()
                self.assertLessEqual(notes_box['height'], 190)
                self.assertLessEqual(dialog_box['height'], VIEWPORT['height'] * 0.72)
                self.assertGreaterEqual(dialog_box['y'], VIEWPORT['height'] * 0.2)
                # 矮屏手机上说明区域继续收缩（并隐藏装饰图标），弹窗依旧不占满整屏。
                page.set_viewport_size({'width': 360, 'height': 480})
                notes.wait_for()
                compact_notes = notes.bounding_box()
                compact_dialog = page.locator('.update-dialog').bounding_box()
                self.assertLessEqual(compact_notes['height'], 130)
                self.assertLessEqual(compact_dialog['height'], 408)
                browser.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
