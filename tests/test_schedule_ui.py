"""Built renderer regressions. Run npm run build and npm run mobile:build first."""
import functools
import http.server
import json
from pathlib import Path
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

class ScheduleUiTests(unittest.TestCase):
    def test_save_failure_queue_and_mobile_validation(self):
        if not (ROOT / 'dist-renderer/index.html').exists() or not (ROOT / 'apps/mobile/dist/index.html').exists():
            self.skipTest('Build both renderers before running UI regression tests')
        from playwright.sync_api import sync_playwright
        book = dict(schemaVersion=1, id='test', name='测试课表', academicYear='2026-2027', semester='1',
                    startDate='2026-09-07', totalWeeks=19, weekendMode='show', courses=[], noClassDates=[],
                    periods=[dict(period=i, start='08:30', end='09:15') for i in range(1, 12)], updatedAt='2026-09-07T00:00:00Z')
        row = dict(id='test', name=book['name'], payload=json.dumps(book), isActive=True, updatedAt=book['updatedAt'])
        boot = dict(version='2.0.0', settings=dict(welcome_accepted=True, theme='light', start_page='schedule',
                    check_updates=False, anonymous_stats=False), schedules=[row], tasks=[], tools=[], browserComponent={}, paths={}, metadata={})
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with sync_playwright() as pw:
                try:
                    browser = pw.chromium.launch(channel='msedge', headless=True)
                except Exception as error:
                    self.skipTest(f'Edge unavailable: {error}')
                page = browser.new_page(viewport={'width':1200, 'height':850})
                page.add_init_script('window.auditBoot=' + json.dumps(boot) + ''';
window.qlu={onEvent:f=>window.auditEmit=f,windowAction:()=>{},fetchAnnouncement:async()=>null,
invoke:async(m,p)=>{if(m==='bootstrap')return structuredClone(auditBoot);if(m==='listSchedules')return structuredClone(auditBoot.schedules);if(m==='listTasks')return [];
if(m==='saveSchedule'){if(window.failSave)throw Error('模拟磁盘写入失败');await new Promise(r=>setTimeout(r,120));auditBoot.schedules=[{...p,isActive:true,updatedAt:new Date().toISOString()}];return p;}}};''')
                url = f'http://127.0.0.1:{server.server_port}'
                page.goto(url+'/dist-renderer/index.html')
                page.get_by_role('button',name='添加课程',exact=True).click()
                page.get_by_placeholder('例如：操作系统').fill('失败测试')
                page.evaluate('window.failSave=true')
                page.get_by_role('button',name='保存课程',exact=True).click()
                page.wait_for_function("document.querySelector('.toast')?.textContent.includes('模拟磁盘')")
                self.assertEqual(page.locator('.course-editor').count(), 1)
                page.locator('.modal-close').click()
                page.evaluate('window.failSave=false')
                page.get_by_role('button',name='课程管理',exact=True).click()
                page.get_by_role('button',name='添加课程',exact=True).last.click()
                page.get_by_placeholder('例如：操作系统').fill('新课程')
                self.assertEqual(page.locator('.modal-backdrop').count(), 1)
                page.get_by_role('button',name='保存课程',exact=True).click()
                page.get_by_role('tab',name='课表设置',exact=True).click()
                page.evaluate('''()=>{const n=document.querySelector('.manager-settings input'),w=document.querySelector('.manager-settings input[type=number]');for(const [e,v] of [[n,'改名'],[w,'20']]){e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}}''')
                page.wait_for_function('JSON.parse(auditBoot.schedules[0].payload).totalWeeks===20')
                page.locator('.modal-close').click()
                page.get_by_role('button',name='设置',exact=True).click()
                page.evaluate("auditEmit('scheduleImport',{event:{type:'success',kind:'workbook',fileName:'x.xls',rows:[['2026-2027年第1学期'],['','星期一'],['','课程◇1-6周(1-2节)◇教室◇教师']]}})")
                page.get_by_role('button',name='课表',exact=True).first.click()
                page.get_by_role('heading',name='导入预览',exact=True).wait_for()
                mobile = browser.new_page(viewport={'width':360, 'height':740})
                mobile.add_init_script('if(!localStorage.testSeed){localStorage.testSeed="1";localStorage.legalNoticeAcceptedVersion="2026-07-19";localStorage.lumatilePreviewSchedules='+json.dumps(json.dumps([row]))+';}')
                mobile.goto(url+'/apps/mobile/dist/index.html')
                mobile.get_by_role('button',name='更多',exact=True).click()
                mobile.get_by_role('button',name='课表设置',exact=True).click()
                mobile.locator('input[type=number]').fill('0')
                mobile.locator('input[type=number]').press('Tab')
                mobile.get_by_role('alert').wait_for()
                self.assertEqual(mobile.evaluate('JSON.parse(JSON.parse(localStorage.lumatilePreviewSchedules)[0].payload).totalWeeks'),19)
                mobile.reload()
                mobile.locator('.schedule-grid').first.wait_for()
                # Both clients must expose overlapping cards through an accessible list.
                book['startDate'] = __import__('datetime').date.today().isoformat()
                book['courses'] = [dict(id=f'c{i}', name=f'冲突课程{i}', teachers=[], color='#336699', credit=None, code='', teachingClass='', note='',
                    meetings=[dict(id=f'm{i}', weeks=list(range(1,20)), weekday=1, startPeriod=1, endPeriod=2,
                                   location='教室', teachers=[], source='manual')]) for i in (1,2)]
                row['payload'] = json.dumps(book)
                mobile.evaluate('(row)=>localStorage.lumatilePreviewSchedules=JSON.stringify([row])', row)
                mobile.reload()
                mobile.get_by_role('button',name='本周 2 个时段冲突',exact=False).click()
                self.assertEqual(mobile.get_by_role('dialog',name='本周冲突课程').get_by_role('button').count(),2)
                page.evaluate('(row)=>auditBoot.schedules=[row]', row)
                page.locator('.modal-close').click()
                page.get_by_role('button',name='设置',exact=True).click()
                page.get_by_role('button',name='课表',exact=True).first.click()
                page.get_by_role('button',name='本周有 2 个冲突时段',exact=False).click()
                self.assertEqual(page.locator('.modal-backdrop .switch-row').count(),2)
                # First welcome acceptance runs startup tasks without a restart.
                first = browser.new_page()
                boot['settings'].update(welcome_accepted=False,check_updates=True,anonymous_stats=True)
                first.add_init_script('window.auditBoot='+json.dumps(boot)+";\nwindow.calls={update:0,stats:0,announcement:0};window.qlu={onEvent:()=>{},windowAction:()=>{},\ncheckUpdate:async()=>{calls.update++;return null},sendStatsBeacon:async()=>{calls.stats++},\nfetchAnnouncement:async()=>{calls.announcement++;return {id:'regression',title:'测试公告',body:'第一行\\n第二行',level:'info'}},\ninvoke:async(m,p)=>{if(m==='bootstrap')return structuredClone(auditBoot);if(m==='saveSettings')return Object.assign(auditBoot.settings,p);if(m==='listSchedules')return auditBoot.schedules;if(m==='listTasks')return []}};\n")
                first.goto(url+'/dist-renderer/index.html')
                first.get_by_role('button',name='确认并开始使用').wait_for()
                self.assertEqual(first.evaluate('calls'),dict(update=0,stats=0,announcement=0))
                first.get_by_role('checkbox').check()
                first.get_by_role('button',name='确认并开始使用').click()
                first.locator('.announcement-body').wait_for()
                self.assertEqual(first.locator('.announcement-body').evaluate('(e)=>getComputedStyle(e).whiteSpace'),'pre-wrap')
                self.assertEqual(first.evaluate('calls'),dict(update=1,stats=1,announcement=1))
                first.get_by_role('button',name='知道了').click()
                self.assertEqual(first.evaluate('localStorage.lastAnnouncementId'),'regression')
                browser.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

if __name__ == '__main__':
    unittest.main()
