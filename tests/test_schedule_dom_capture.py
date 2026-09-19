from __future__ import annotations

import json
import unittest

from qlu_toolbox.modules.schedule_import.domain import build_dom_capture_script


HTML = """
<select id="xnm"><option selected>2026-2027</option></select>
<select id="xqm"><option selected>第一学期</option></select>
<table id="table1"><tr><td id="3-3" rowspan="2"><div>
  <a class="title">软件项目管理</a>
  <p><span title="节/周"></span>(3-4节，7-8节)1-15周(单)</p>
  <p><span title="上课地点"></span>彩石校区 彩石南215216</p>
  <p><span data-original-title="教师"></span>张老师，李老师</p>
  <p><span title="学分"></span>2.5</p>
</div></td></tr></table>
"""

MULTI_HTML = """
<div>2026-2027学年 第1学期</div>
<table id="table1"><tr><td id="1-1"><div class="wrapper">
  <div class="course"><a class="title">单周课程</a><p><span title="节/周"></span>(1-2节)1-15周(单)</p></div>
  <div class="course"><a class="title">双周课程</a><p><span title="节/周"></span>(1-2节)2-16周(双)</p></div>
</div></td></tr></table>
"""


class ScheduleDomCaptureTests(unittest.TestCase):
    def test_extracts_semantic_schedule_fields(self):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            self.skipTest(f"缺少 Playwright：{exc}")
        with sync_playwright() as playwright:
            try:
                browser = playwright.chromium.launch(channel="msedge", headless=True)
            except Exception as exc:
                self.skipTest(str(exc).splitlines()[0])
            try:
                page = browser.new_page()
                page.set_content(HTML)
                page.evaluate("Array.prototype.some = function(callback, self) { for (let index = 0; index < this.length; index += 1) if (callback.call(self || window, index, this[index], this)) return true; return false }")
                page.evaluate("window.__LUMATILE_QLU_DOM_FORCE__ = true")
                state = json.loads(page.evaluate(build_dom_capture_script()))
                self.assertEqual(state["error"], "")
                self.assertEqual(state["result"]["academicYear"], "2026-2027")
                self.assertEqual(state["result"]["semester"], "1")
                self.assertEqual(state["result"]["candidateCount"], 1)
                self.assertEqual(state["result"]["records"][0]["weekday"], 3)
                self.assertEqual(state["result"]["records"][0]["scheduleText"], "(3-4节，7-8节)1-15周(单)")
                self.assertEqual(state["result"]["records"][0]["location"], "彩石校区 彩石南215216")
            finally:
                browser.close()

    def test_keeps_multiple_courses_inside_one_table_cell(self):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            self.skipTest(f"缺少 Playwright：{exc}")
        with sync_playwright() as playwright:
            try:
                browser = playwright.chromium.launch(channel="msedge", headless=True)
            except Exception as exc:
                self.skipTest(str(exc).splitlines()[0])
            try:
                page = browser.new_page()
                page.set_content(MULTI_HTML)
                page.evaluate("window.__LUMATILE_QLU_DOM_FORCE__ = true")
                result = json.loads(page.evaluate(build_dom_capture_script()))["result"]
                self.assertEqual(result["candidateCount"], 2)
                self.assertEqual([record["name"] for record in result["records"]], ["单周课程", "双周课程"])
            finally:
                browser.close()


if __name__ == "__main__":
    unittest.main()
