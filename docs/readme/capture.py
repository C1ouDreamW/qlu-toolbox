"""从真实 Vue 页面生成 README 素材；仅替换本地 IPC，使用合成样本。"""
from __future__ import annotations

import argparse
import io
import json
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
sys.path.insert(0, str(ROOT))
from qlu_toolbox.modules.gpa_calculator.domain import parse_grade_xlsx
from qlu_toolbox.modules.credit_report.domain import CourseRecord, default_rules, rules_to_dict, summarize


def synthetic_data():
    names = [("界面构成基础", "3", "92"), ("数据叙事工作坊", "2", "86"),
             ("交互系统实验", "2", "89"), ("原型设计实践", "2", "78"), ("跨学科创新项目", "3", "94")]
    rows = []
    for index, (name, credit, score) in enumerate(names):
        for value, component in [("90", "平时成绩(30%)"), (score, "总评")]:
            rows.append([name, "2026-2027", "1", "虚拟学院", f"DEMO-{index + 1:04}",
                         "虚拟展示班", credit, value, component])
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / "虚拟展示成绩.xlsx"
        runpy.run_path(str(ROOT / "tests/test_gpa_calculator.py"))["create_workbook"](path, rows)
        workbook = parse_grade_xlsx(path)
    workbook["filePath"] = "虚拟展示成绩.xlsx"
    items = [
        {"kch": f"DEMO-C{index}", "kcmc": name, "xf": "1", "zcjmc": score,
         "kclbmc": "公共选修课", "kcxzmc": "选修", "xnm": "2026", "xqm": "3"}
        for index, (name, score) in enumerate([
            ("四史专题", "90"), ("文化与社会", "88"), ("安全与应急", "91"),
            ("公共艺术鉴赏", "85"), ("公共艺术与生活", "在修"),
            ("科学与未来", "92"), ("经济管理入门", "86"), ("英语文化交流", "89"),
        ])
    ]
    report = summarize([CourseRecord.from_item(item) for item in items], default_rules())
    assert len(workbook["courses"]) == 5 and report["total_earned"] > 0
    return {"workbook": workbook, "report": report, "rules": rules_to_dict(default_rules())}


def capture(desktop_url: str, mobile_url: str, output: Path):
    output.mkdir(parents=True, exist_ok=True)
    fixture = synthetic_data()
    tools = [
        {"id": identifier, "name": name, "description": description, "category": "校园效率", "version": VERSION, "icon_text": ""}
        for identifier, name, description in [
            ("schedule", "课表工具", "周视图、多课表管理与跨端备份"),
            ("grade-export", "分项成绩导出", "查询并校验 Excel，文件保存到本机"),
            ("gpa-calculator", "绩点计算器", "自由勾选课程，实时计算加权 GPA"),
            ("credit-report", "学分修读情况", "核对模块学分与选课方向"),
        ]
    ]
    boot = {
        "version": VERSION, "tasks": [], "schedules": [], "tools": tools, "tool": tools[1],
        "defaultAcademicYear": "2026", "semesters": {"3": "第一学期", "12": "第二学期"},
        "settings": {"schema_version": 1, "welcome_accepted": True, "default_output_dir": "演示文件",
                     "preferred_browser": "auto", "keep_login_state": False, "theme": "light",
                     "check_updates": False, "anonymous_stats": False, "start_page": "schedule"},
        "browserComponent": {"installed": False, "installing": False}, "paths": {}, "metadata": {},
    }
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context = browser.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=1, color_scheme="light")
        # 隔离浏览器，不访问真实教务、更新源或统计服务。
        context.route("**/*", lambda route: route.continue_() if route.request.url.startswith((desktop_url, mobile_url)) else route.abort())
        page = context.new_page()
        page.clock.install(time=__import__("datetime").datetime(2026, 10, 7, 10, 0))
        page.add_init_script("""(fixture => {
          let listener;
          const boot = fixture.boot;
          window.qlu = {
            platform: 'win32', syncTheme() {}, windowAction() {},
            onEvent(callback) { listener = callback; return () => {}; },
            selectFile: async () => '虚拟展示成绩.xlsx', fetchAnnouncement: async () => null,
            async invoke(method) {
              if (method === 'bootstrap') {
                const core = await import('/@fs/""" + ROOT.as_posix() + """/packages/academic-core/src/index.ts');
                const schedule = core.createShowcaseSchedule(new Date());
                window.__readmeSchedule = { id: schedule.id, name: schedule.name, payload: JSON.stringify(schedule),
                  isActive: true, updatedAt: '2026-10-07T02:00:00Z' };
                boot.schedules = [window.__readmeSchedule];
                return boot;
              }
              if (method === 'listTasks') return [];
              if (method === 'listSchedules') return boot.schedules;
              if (method === 'parseGradeWorkbook') return structuredClone(fixture.workbook);
              if (method === 'getCreditRules') return fixture.rules;
              if (method === 'startCreditReport') {
                setTimeout(() => listener('creditReport', {taskId: 'readme-demo', event: {type: 'success', report: fixture.report}}), 100);
                return {taskId: 'readme-demo'};
              }
              throw Error('README 未提供的 IPC: ' + method);
            }
          };
        })(""" + json.dumps({**fixture, "boot": boot}, ensure_ascii=False) + ");")
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(desktop_url)
        page.locator(".tt-course").first.wait_for()
        page.wait_for_timeout(350)

        def screenshot(target, name):
            target.screenshot(path=str(output / name), animations="disabled")

        screenshot(page, "desktop-schedule.png")
        frames = [(page.screenshot(animations="disabled"), 1500)]
        page.get_by_role("button", name="下一周", exact=True).click()
        page.wait_for_timeout(300)
        frames.append((page.screenshot(animations="disabled"), 1300))
        page.get_by_role("button", name="上一周", exact=True).click()
        page.locator(".tt-course-conflict").filter(has_text="信息可视化").first.click()
        page.wait_for_timeout(250)
        frames.append((page.screenshot(animations="disabled"), 1600))
        page.get_by_role("radio", name="在课表中显示信息可视化专题 B，第3–4节", exact=True).check()
        page.wait_for_timeout(200)
        frames.append((page.screenshot(animations="disabled"), 1400))
        page.locator(".modal-close").click()
        page.wait_for_timeout(200)
        frames.append((page.screenshot(animations="disabled"), 1500))
        save_gif(frames, output / "schedule.gif", 1000)
        page.locator(".side-nav").get_by_role("button", name="首页", exact=True).click()
        screenshot(page, "desktop-home.png")
        page.locator(".side-nav").get_by_role("button", name="全部工具", exact=True).click()
        page.locator(".tool-card").filter(has=page.get_by_role("heading", name="绩点计算器", exact=True)).click()
        page.get_by_role("button", name="选择 XLSX 文件", exact=True).click()
        page.locator(".gpa-course").first.wait_for()
        # 提示条自动消失后录制，保证主画面干净。
        page.wait_for_timeout(3600)
        screenshot(page, "gpa.png")
        summary = page.locator(".gpa-summary .primary strong")
        before = summary.inner_text()
        gpa_frames = [(page.screenshot(animations="disabled"), 1600)]
        page.get_by_role("button", name="不计算数据叙事工作坊", exact=True).click()
        assert summary.inner_text() != before, "课程勾选必须真实改变 GPA"
        gpa_frames.append((page.screenshot(animations="disabled"), 1600))
        page.get_by_role("button", name="不计算界面构成基础", exact=True).click()
        gpa_frames.append((page.screenshot(animations="disabled"), 1600))
        page.get_by_role("button", name="计算界面构成基础", exact=True).click()
        page.get_by_role("button", name="计算数据叙事工作坊", exact=True).click()
        assert summary.inner_text() == before
        gpa_frames.append((page.screenshot(animations="disabled"), 1800))
        save_gif(gpa_frames, output / "gpa.gif", 1000)
        page.set_viewport_size({"width": 1280, "height": 2000})
        page.locator(".side-nav").get_by_role("button", name="全部工具", exact=True).click()
        page.locator(".tool-card").filter(has=page.get_by_role("heading", name="学分修读情况", exact=True)).click()
        page.get_by_role("button", name="开始统计", exact=True).click()
        page.locator(".credit-modules").wait_for()
        page.wait_for_timeout(3600)
        for part in ["overview", "gaps", "recs", "modules"]:
            page.locator(".credit-" + part).screenshot(path=str(output / ("credit-" + part + ".png")), animations="disabled")
        schedule = page.evaluate("window.__readmeSchedule")
        mobile = context.new_page()
        mobile.on("pageerror", lambda error: errors.append(str(error)))
        mobile.set_viewport_size({"width": 412, "height": 892})
        mobile.clock.install(time=__import__("datetime").datetime(2026, 10, 7, 10, 0))
        mobile.add_init_script("localStorage.setItem('lumatilePreviewSchedules', " + json.dumps(json.dumps([schedule], ensure_ascii=False)) + ");localStorage.setItem('legalNoticeAcceptedVersion','2026-07-19');localStorage.setItem('autoUpdateCheck','false');localStorage.setItem('anonymousStats','false');")
        mobile.goto(mobile_url)
        mobile.locator(".meeting-card").first.wait_for()
        mobile.wait_for_timeout(300)
        screenshot(mobile, "mobile-schedule.png")
        assert not errors, errors
        media = Path(__file__).resolve().parent
        from PIL import Image
        for name in ["desktop-home", "desktop-schedule", "mobile-schedule"]:
            Image.open(output / (name + ".png")).save(media / (name + ".webp"), lossless=True, method=6)
        for name in ["schedule.gif", "gpa.gif"]:
            shutil.copyfile(output / name, media / name)
        layout = browser.new_page()
        for view, width, height in [("hero", 1600, 1120), ("credit", 1280, 940)]:
            layout.set_viewport_size({"width": width, "height": height})
            layout.goto((media / "showcase.html").as_uri())
            layout.evaluate("([view, folder]) => {document.body.dataset.view = view; for(const image of document.querySelectorAll('img[data-asset]')) image.src = folder + '/' + image.dataset.asset}", [view, output.resolve().as_uri()])
            layout.locator(".version").evaluate("(element, version) => element.textContent = 'v' + version", VERSION)
            layout.wait_for_function("[...document.images].every(image => image.complete && image.naturalWidth > 0)")
            raw = layout.screenshot()
            Image.open(io.BytesIO(raw)).save(media / (view + ".webp"), lossless=True, method=6)
        browser.close()
    export_logo(output)
    print("真实页面截图及交互核验完成：", output)


def save_gif(frames, path: Path, width: int):
    # Pillow 只负责图片编码；画面及状态变化由真实 Vue 组件提供。
    from PIL import Image
    images = [Image.open(io.BytesIO(data)).convert("RGB") for data, _ in frames]
    images = [image.resize((width, round(image.height * width / image.width)), Image.Resampling.LANCZOS) for image in images]
    images[0].save(path, save_all=True, append_images=images[1:], duration=[duration for _, duration in frames], loop=0, optimize=True)


def export_logo(output: Path):
    from PIL import Image
    ffmpeg = ROOT / "lumatile-logo-animation/node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe"
    folder = output / "logo-frames"
    folder.mkdir(exist_ok=True)
    subprocess.run([str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y", "-i",
                    str(ROOT / "lumatile-logo-animation/out/logo-reveal.mp4"), "-vf", "scale=192:192", "-r", "15",
                    str(folder / "%03d.png")], check=True)
    # 固定读取 3 秒 / 15 FPS 的帧，避免上次生成的多余文件影响编码。
    frames = [Image.open(folder / f"{index:03d}.png").convert("RGB") for index in range(1, 46)]
    durations = [70, 60, 70] * 15
    durations[-1] += 2000
    frames[0].save(Path(__file__).resolve().parent / "logo-reveal.gif", save_all=True,
                   append_images=frames[1:], duration=durations, loop=0, optimize=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--desktop", default="http://127.0.0.1:5179")
    parser.add_argument("--mobile", default="http://127.0.0.1:5180")
    parser.add_argument("--output", type=Path, default=ROOT / "tmp/readme-capture")
    args = parser.parse_args()
    capture(args.desktop.rstrip("/"), args.mobile.rstrip("/"), args.output)
