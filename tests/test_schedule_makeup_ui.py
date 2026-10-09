"""Actual renderer regressions; build desktop and mobile before running."""
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


def schedule():
    courses = []
    for name, weekday, weeks, start in [
        ('调来的周一课', 1, [1], 1),
        ('原周日后续课', 7, [3], 3),
        ('周一后续课', 1, [3], 5),
    ]:
        courses.append(dict(
            id=name, name=name, teachers=[], color='#336699', credit=None,
            code='', teachingClass='', note='', meetings=[dict(
                id=name, weeks=weeks, weekday=weekday, startPeriod=start, endPeriod=start + 1,
                location='测试教室', teachers=[], source='manual')]))
    return dict(schemaVersion=1, id='makeup-test', name='调休回归课表', academicYear='2026-2027',
                semester='1', startDate='2026-09-07', totalWeeks=19, weekendMode='show',
                showOtherWeekCourses=True, courses=courses, noClassDates=[],
                periods=[dict(period=i, start='08:30', end='09:15') for i in range(1, 12)],
                updatedAt='2026-09-07T00:00:00Z')


class ScheduleMakeupUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not all((ROOT / p).exists() for p in ('dist-renderer/index.html', 'apps/mobile/dist/index.html')):
            raise unittest.SkipTest('Build both renderers before running UI regressions')
        from playwright.sync_api import sync_playwright
        cls.pw = sync_playwright().start()
        try:
            cls.browser = cls.pw.chromium.launch(channel='msedge', headless=True)
        except Exception as error:
            cls.pw.stop()
            raise unittest.SkipTest(f'Edge unavailable: {error}')
        cls.server = http.server.ThreadingHTTPServer(
            ('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def open_client(self, book, mobile):
        page = self.browser.new_page(viewport={'width': 400 if mobile else 1350, 'height': 900})
        self.addCleanup(page.close)
        # Freeze the calendar independently of the machine's date: week 2, Sunday.
        page.clock.install(time=__import__('datetime').datetime(2026, 9, 20, 12))
        row = dict(id=book['id'], name=book['name'], payload=json.dumps(book),
                   isActive=True, updatedAt=book['updatedAt'])
        if mobile:
            page.add_init_script('''if (!localStorage.testSeed) {
                localStorage.testSeed = '1';
                localStorage.legalNoticeAcceptedVersion = '2026-07-19';
                localStorage.lumatilePreviewSchedules = ''' + json.dumps(json.dumps([row])) + ';}')
            page.goto(self.url + '/apps/mobile/dist/index.html')
            page.locator('.schedule-grid').first.wait_for()
        else:
            boot = dict(version='2.0.4', settings=dict(welcome_accepted=True, theme='light',
                        start_page='schedule', check_updates=False, anonymous_stats=False),
                        schedules=[row], tasks=[], tools=[], browserComponent={}, paths={}, metadata={})
            page.add_init_script('window.auditBoot=' + json.dumps(boot) + ''';
                window.qlu={onEvent:()=>{},windowAction:()=>{},fetchAnnouncement:async()=>null,
                invoke:async(m)=>{if(m==='bootstrap')return structuredClone(auditBoot);
                if(m==='listSchedules')return structuredClone(auditBoot.schedules);
                if(m==='listTasks')return [];}};''')
            page.goto(self.url + '/dist-renderer/index.html')
            page.get_by_role('combobox', name='选择周次').wait_for()
        return page

    def test_add_remove_preserves_manual_dates_and_multiple_source_references(self):
        for manual in (False, True):
            with self.subTest(manual=manual):
                book = schedule()
                if manual:
                    # Even identical legacy-looking reason text is user data; never guess its origin.
                    book['noClassDates'] = [dict(date='2026-09-07', reason='调休补课（原课停上）')]
                page = self.open_client(book, mobile=True)
                page.get_by_role('button', name='更多', exact=True).click()
                page.get_by_role('button', name='课表设置', exact=True).click()
                group = page.locator('.settings-group').filter(has=page.get_by_role('heading', name='调休/补课'))
                for target in ('2026-09-20', '2026-09-27'):
                    group.locator('input[type=date]').nth(0).fill(target)
                    group.locator('input[type=date]').nth(1).fill('2026-09-07')
                    group.get_by_role('button', name='添加调休').click()
                    page.wait_for_function('''target => JSON.parse(JSON.parse(
                        localStorage.lumatilePreviewSchedules)[0].payload).dateOverrides.some(x=>x.date===target)''', arg=target)
                self.assertEqual(group.locator('.off-row').count(), 2)
                for remaining in (1, 0):
                    group.locator('.off-row button').first.click()
                    page.wait_for_function('''n => JSON.parse(JSON.parse(
                        localStorage.lumatilePreviewSchedules)[0].payload).dateOverrides.length===n''', arg=remaining)
                    saved = page.evaluate('JSON.parse(JSON.parse(localStorage.lumatilePreviewSchedules)[0].payload)')
                    self.assertEqual(saved['noClassDates'], book['noClassDates'])
                page.reload()
                page.locator('.schedule-grid').first.wait_for()
                # The carousel includes week 1: source classes return only without a manual suspension.
                self.assertEqual(page.get_by_role('button', name='调来的周一课', exact=False).count(), 0 if manual else 1)

    def test_cross_week_makeup_preview_on_both_clients(self):
        for mobile in (False, True):
            for previews in (False, True):
                with self.subTest(mobile=mobile, previews=previews):
                    book = schedule()
                    book['showOtherWeekCourses'] = previews
                    book['dateOverrides'] = [dict(date='2026-09-20', sourceDate='2026-09-07', reason='调休')]
                    page = self.open_client(book, mobile)
                    # Mobile renders previous/current/next weeks, so inspect only the current slide.
                    board = page.locator('.schedule-slide').nth(1) if mobile else page.locator('.schedule-page')
                    board.get_by_role('button', name='调来的周一课', exact=False).wait_for()
                    self.assertEqual(board.get_by_role('button', name='原周日后续课', exact=False).count(), 0)
                    self.assertEqual(board.get_by_role('button', name='调来的周一课', exact=False).count(), 1)
                    # Ordinary Monday can preview week-3 Monday, but make-up Sunday cannot.
                    self.assertEqual(board.get_by_role('button', name='周一后续课', exact=False).count(), int(previews))


if __name__ == '__main__':
    unittest.main()
