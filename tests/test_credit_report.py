from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from qlu_toolbox.core.paths import AppPaths
from qlu_toolbox.modules.credit_report.domain import (
    CourseRecord,
    classify_score,
    default_rules,
    load_rules,
    normalize_course_name,
    normalize_rules,
    parse_requirement_tree,
    plan_from_tree,
    rules_from_dict,
    save_rules,
    summarize,
)

# 取自真实修读要求页的服务端渲染片段（简化版，保留关键属性与结构）。
SAMPLE_XDYQ_HTML = r"""
<div class="treeview">
<ul id='ul'><li id='li31C24A95C0C86EFDE063161611AC20AA' class='' fxfyqjd_id='' kcxf='0'>
<div class="title" data-content="" xfyqjd_id='31C24A95C0C86EFDE063161611AC20AA' leaf='false' sfmjd='0' xdlx='zx'><p class='title1' id='p31C24A95C0C86EFDE063161611AC20AA' yqzdxf='92' >主修&nbsp;"+$.i18n.jwglxt["zdyqxf"]+":92"+$.i18n.jwglxt["kczxf"]+":<span id='kczxf31C24A95C0C86EFDE063161611AC20AA'>0</span>&nbsp;"+"&nbsp;"+"<span id='showKc31C24A95C0C86EFDE063161611AC20AA'></span></p><i id='xfzt31C24A95C0C86EFDE063161611AC20AA'></i></div></li></ul>").appendTo($("#jxdyq"));
$("<ul id='ul31C24A95C0C96EFDE063161611AC20AA'><li id='li31C24A95C0C96EFDE063161611AC20AA' class='' fxfyqjd_id='' kcxf='0'>
<div class="title" data-content="" xfyqjd_id='31C24A95C0C96EFDE063161611AC20AA' leaf='false' sfmjd='0' xdlx='zx'><p class='title1' id='p31C24A95C0C96EFDE063161611AC20AA' yqzdxf='10' >综合素质选修课&nbsp;"+$.i18n.jwglxt["zdyqxf"]+":10"+$.i18n.jwglxt["kczxf"]+":<span id='kczxf31C24A95C0C96EFDE063161611AC20AA'>0</span></p></div></li></ul>").appendTo($("#li31C24A95C0C86EFDE063161611AC20AA"));
$("<ul id='ul31C24A95C11F6EFDE063161611AC20AA'><li id='li31C24A95C11F6EFDE063161611AC20AA' class='' fxfyqjd_id='' kcxf='0'>
<div class="title" data-content="" xfyqjd_id='31C24A95C11F6EFDE063161611AC20AA' leaf='false' sfmjd='0' xdlx='zx'><p class='title1' id='p31C24A95C11F6EFDE063161611AC20AA' yqzdxf='2' >思想政治理论模块&nbsp;"+$.i18n.jwglxt["zdyqxf"]+":2"+$.i18n.jwglxt["kczxf"]+":<span id='kczxf31C24A95C11F6EFDE063161611AC20AA'>0</span></p></div></li></ul>").appendTo($("#li31C24A95C0C96EFDE063161611AC20AA"));
$("<ul id='ul31C24A95C1206EFDE063161611AC20AA'><li id='li31C24A95C1206EFDE063161611AC20AA' class='' fxfyqjd_id='' kcxf='0'>
<div class="title" data-content="" xfyqjd_id='31C24A95C1206EFDE063161611AC20AA' leaf='true' sfmjd='1' xdlx='zx'><p class='title1' id='p31C24A95C1206EFDE063161611AC20AA' yqzdxf='1' >四史&nbsp;"+$.i18n.jwglxt["zdyqxf"]+":1"+$.i18n.jwglxt["kczxf"]+":<span id='kczxf31C24A95C1206EFDE063161611AC20AA'>0</span></p></div></li></ul>").appendTo($("#li31C24A95C11F6EFDE063161611AC20AA"));
$("<ul id='ul31C24A95C1236EFDE063161611AC20AA'><li id='li31C24A95C1236EFDE063161611AC20AA' class='' fxfyqjd_id='' kcxf='0'>
<div class="title" data-content="" xfyqjd_id='31C24A95C1236EFDE063161611AC20AA' leaf='true' sfmjd='1' xdlx='zx'><p class='title1' id='p31C24A95C1236EFDE063161611AC20AA' yqzdxf='1' >文化&nbsp;"+$.i18n.jwglxt["zdyqxf"]+":1"+$.i18n.jwglxt["kczxf"]+":<span id='kczxf31C24A95C1236EFDE063161611AC20AA'>0</span></p></div></li></ul>").appendTo($("#li31C24A95C11F6EFDE063161611AC20AA"));
$("<ul id='ul31C24A95C1216EFDE063161611AC20AA'><li id='li31C24A95C1216EFDE063161611AC20AA' class='' fxfyqjd_id='' kcxf='0'>
<div class="title" data-content="" xfyqjd_id='31C24A95C1216EFDE063161611AC20AA' leaf='false' sfmjd='1' xdlx='zx'><p class='title1' id='p31C24A95C1216EFDE063161611AC20AA' yqzdxf='2' >安全教育模块&nbsp;"+$.i18n.jwglxt["zdyqxf"]+":2"+$.i18n.jwglxt["kczxf"]+":<span id='kczxf31C24A95C1216EFDE063161611AC20AA'>0</span></p></div></li></ul>").appendTo($("#li31C24A95C0C96EFDE063161611AC20AA"));
$("<ul id='ul31C24A95C1256EFDE063161611AC20AA'><li id='li31C24A95C1256EFDE063161611AC20AA' class='' fxfyqjd_id='' kcxf='0'>
<div class="title" data-content="" xfyqjd_id='31C24A95C1256EFDE063161611AC20AA' leaf='false' sfmjd='1' xdlx='zx'><p class='title1' id='p31C24A95C1256EFDE063161611AC20AA' yqzdxf='2' >艺术体育模块&nbsp;"+$.i18n.jwglxt["zdyqxf"]+":2"+$.i18n.jwglxt["kczxf"]+":<span id='kczxf31C24A95C1256EFDE063161611AC20AA'>0</span></p></div></li></ul>").appendTo($("#li31C24A95C0C96EFDE063161611AC20AA"));
$("<ul id='ul31C24A95C12D6EFDE063161611AC20AA'><li id='li31C24A95C12D6EFDE063161611AC20AA' class='' fxfyqjd_id='' kcxf='0'>
<div class="title" data-content="" xfyqjd_id='31C24A95C12D6EFDE063161611AC20AA' leaf='false' sfmjd='1' xdlx='zx'><p class='title1' id='p31C24A95C12D6EFDE063161611AC20AA' yqzdxf='4' >其他模块&nbsp;"+$.i18n.jwglxt["zdyqxf"]+":4"+$.i18n.jwglxt["kczxf"]+":<span id='kczxf31C24A95C12D6EFDE063161611AC20AA'>0</span></p></div></li></ul>").appendTo($("#li31C24A95C0C96EFDE063161611AC20AA"));
</div>
"""


def record(
    code: str,
    name: str,
    credit: float = 1.0,
    score: str = "85",
    category: str = "公共选修课",
    nature: str = "公选",
    state: str | None = None,
) -> CourseRecord:
    return CourseRecord(
        code=code,
        name=name,
        credit=credit,
        score_text=score,
        category_text=category,
        nature_text=nature,
        academic_year="2025",
        semester="3",
        state=state or classify_score(score),
    )


def plan_fixture() -> dict:
    tree = parse_requirement_tree(SAMPLE_XDYQ_HTML)
    plan = plan_from_tree(tree)
    assert plan is not None
    plan["course_map"] = {
        "sishi": [{"code": "B037101", "name": "党史", "credit": "1"}],
        "wenhua": [{"code": "B037102", "name": "山东红色文化与时代价值（智慧树）", "credit": "1"}],
        "yishu": [{"code": "B037103", "name": "敦煌的艺术", "credit": "2"}],
    }
    return plan


class ClassifyScoreTest(unittest.TestCase):
    def test_numeric_scores(self) -> None:
        self.assertEqual(classify_score("85"), "passed")
        self.assertEqual(classify_score("60"), "passed")
        self.assertEqual(classify_score("59.5"), "failed")

    def test_text_scores(self) -> None:
        self.assertEqual(classify_score("优秀"), "passed")
        self.assertEqual(classify_score("良好"), "passed")
        self.assertEqual(classify_score("合格"), "passed")
        self.assertEqual(classify_score("及格"), "passed")
        self.assertEqual(classify_score("不及格"), "failed")
        self.assertEqual(classify_score("缺考"), "failed")
        self.assertEqual(classify_score("作弊"), "failed")

    def test_in_progress(self) -> None:
        self.assertEqual(classify_score(""), "in_progress")
        self.assertEqual(classify_score("在修"), "in_progress")


class RequirementTreeTest(unittest.TestCase):
    def test_parse_tree(self) -> None:
        tree = parse_requirement_tree(SAMPLE_XDYQ_HTML)
        self.assertTrue(tree)
        plan = plan_from_tree(tree)
        self.assertIsNotNone(plan)
        self.assertAlmostEqual(plan["total_required"], 10.0)
        self.assertAlmostEqual(plan["modules"]["sizheng"], 2.0)
        self.assertAlmostEqual(plan["modules"]["anquan"], 2.0)
        self.assertAlmostEqual(plan["modules"]["yishu"], 2.0)
        self.assertNotIn("qita", plan["modules"])
        self.assertAlmostEqual(plan["subs"]["sishi"], 1.0)
        self.assertAlmostEqual(plan["subs"]["wenhua"], 1.0)
        self.assertEqual(
            set(plan["node_ids"]),
            {"sizheng", "anquan", "yishu", "sishi", "wenhua"},
        )


class SummarizeTest(unittest.TestCase):
    def test_official_mapping_counts(self) -> None:
        report = summarize(
            [
                record("B037101", "党史", 1.0, score="90"),
                record("B037102", "山东红色文化与时代价值（智慧树）", 1.0, score="93"),
                record("B037103", "敦煌的艺术（智慧树）", 2.0, score="90"),
                record("B037104", "人工智能伦理与安全（智慧树）", 1.0, score="94"),
                record("B039001", "程序设计基础", 4.0, score="99", category="专业基础课", nature="必修"),
            ],
            default_rules(),
            plan_fixture(),
        )
        self.assertEqual(report["source"], "plan")
        self.assertAlmostEqual(report["total_earned"], 5.0)
        self.assertAlmostEqual(report["total_required"], 10.0)
        by_key = {module["key"]: module for module in report["modules"]}
        self.assertAlmostEqual(by_key["sizheng"]["earned"], 2.0)
        self.assertTrue(by_key["sizheng"]["satisfied"])
        subs = {sub["key"]: sub for sub in by_key["sizheng"]["subs"]}
        self.assertTrue(subs["sishi"]["satisfied"])
        self.assertTrue(subs["wenhua"]["satisfied"])
        self.assertAlmostEqual(by_key["yishu"]["earned"], 2.0)
        self.assertTrue(by_key["yishu"]["satisfied"])
        self.assertAlmostEqual(by_key["anquan"]["earned"], 1.0)
        self.assertAlmostEqual(by_key["anquan"]["gap"], 1.0)
        self.assertFalse(any(module["key"] == "qita" for module in report["modules"]))
        # 必修课不应计入
        self.assertFalse(any(c["name"] == "程序设计基础" for c in by_key["anquan"]["courses"]))

    def test_fallback_keywords_when_no_plan(self) -> None:
        report = summarize(
            [
                record("A1", "党史", 1.0),
                record("A2", "中国文化概论", 2.0),
                record("C1", "影视鉴赏", 2.0),
            ],
            default_rules(),
        )
        self.assertEqual(report["source"], "fallback")
        self.assertAlmostEqual(report["total_earned"], 5.0)
        by_key = {module["key"]: module for module in report["modules"]}
        self.assertAlmostEqual(by_key["sizheng"]["earned"], 3.0)
        self.assertAlmostEqual(by_key["yishu"]["earned"], 2.0)

    def test_failing_course_not_counted(self) -> None:
        report = summarize(
            [record("B037103", "敦煌的艺术", 2.0, score="50")], default_rules(), plan_fixture()
        )
        self.assertAlmostEqual(report["total_earned"], 0.0)
        yishu = next(module for module in report["modules"] if module["key"] == "yishu")
        self.assertFalse(yishu["satisfied"])

    def test_repeated_course_counted_once(self) -> None:
        report = summarize(
            [
                record("B037103", "敦煌的艺术", 2.0, score="50"),
                record("B037103", "敦煌的艺术", 2.0, score="88"),
            ],
            default_rules(),
            plan_fixture(),
        )
        self.assertAlmostEqual(report["total_earned"], 2.0)

    def test_art_major_waives_public_art(self) -> None:
        rules = default_rules()
        rules.art_major = True
        report = summarize([], rules)
        by_key = {module["key"]: module for module in report["modules"]}
        self.assertTrue(by_key["yishu"]["satisfied"])

    def test_unmatched_elective_counts_toward_total(self) -> None:
        # 「其他模块」不是硬性要求：无法归类的公选课计入总学分兜底。
        report = summarize(
            [
                record("X1", "围棋入门", 2.0),
                record("B037101", "党史", 1.0, score="90"),
            ],
            default_rules(),
            plan_fixture(),
        )
        self.assertAlmostEqual(report["total_earned"], 3.0)
        self.assertEqual(len(report["extra_elective"]), 1)
        self.assertFalse(any(module["key"] == "qita" for module in report["modules"]))

    def test_required_courses_never_counted(self) -> None:
        # 大学英语（必修）即使命中“外语”关键词也不得计入综合素质选修课。
        report = summarize(
            [
                record("E1", "大学英语 1", 2.0, category="公共基础课", nature="必修"),
                record("P1", "大学体育（1）", 1.0, category="公共基础课", nature="必修"),
                record("H1", "大学生心理健康教育1", 1.0, category="公共基础课", nature="必修"),
            ],
            default_rules(),
            plan_fixture(),
        )
        self.assertAlmostEqual(report["total_earned"], 0.0)
        by_key = {module["key"]: module for module in report["modules"]}
        self.assertAlmostEqual(by_key["waiyu"]["earned"], 0.0)
        self.assertAlmostEqual(by_key["yishu"]["earned"], 0.0)
        self.assertEqual(len(report["unmatched"]), 3)

    def test_major_elective_not_counted(self) -> None:
        # 专业选修课（选修但非公选）不属于综合素质选修课。
        report = summarize(
            [record("M1", "学业指导 I", 0.5, category="专业课", nature="选修")],
            default_rules(),
            plan_fixture(),
        )
        self.assertAlmostEqual(report["total_earned"], 0.0)
        self.assertEqual(len(report["unmatched"]), 1)

    def test_unmatched_general_elective_goes_to_extra_with_plan(self) -> None:
        report = summarize(
            [record("X1", "围棋入门", 2.0)],
            default_rules(),
            plan_fixture(),
        )
        self.assertEqual(len(report["extra_elective"]), 1)
        self.assertAlmostEqual(report["total_earned"], 2.0)

    def test_sports_elective_does_not_satisfy_public_art(self) -> None:
        # 艺术体育模块的 2 学分必须是公共艺术类课程，体育类公选课不算。
        report = summarize(
            [record("T1", "网球", 2.0)],
            default_rules(),
            plan_fixture(),
        )
        yishu = next(module for module in report["modules"] if module["key"] == "yishu")
        self.assertAlmostEqual(yishu["earned"], 2.0)
        self.assertFalse(yishu["satisfied"])
        subs = {sub["key"]: sub for sub in yishu["subs"]}
        self.assertAlmostEqual(subs["gongyi"]["earned"], 0.0)
        self.assertFalse(subs["gongyi"]["satisfied"])
        self.assertTrue(any("艺术体育" in item for item in report["unfulfilled"]))


class NormalizeNameTest(unittest.TestCase):
    def test_strips_parenthesis_suffix(self) -> None:
        self.assertEqual(normalize_course_name("敦煌的艺术（智慧树）"), "敦煌的艺术")
        self.assertEqual(normalize_course_name(" 党史 "), "党史")


class RulesStoreTest(unittest.TestCase):
    def test_roundtrip_and_reset(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            paths = AppPaths(
                config_dir=Path(root) / "config",
                data_dir=Path(root) / "data",
                log_dir=Path(root) / "logs",
                profile_dir=Path(root) / "profiles",
                browser_dir=Path(root) / "browsers",
            )
            self.assertFalse(load_rules(paths)["art_major"])
            saved = save_rules(paths, {"art_major": True, "total_required": 12})
            self.assertTrue(saved["art_major"])
            self.assertEqual(saved["total_required"], 12)
            restored = rules_from_dict(load_rules(paths))
            self.assertTrue(restored.art_major)
            self.assertAlmostEqual(restored.total_required, 12)

    def test_normalize_rejects_unknown_modules(self) -> None:
        normalized = normalize_rules({"modules": [{"key": "nope", "required": 5}]})
        keys = {module["key"] for module in normalized["modules"]}
        self.assertNotIn("nope", keys)
        self.assertIn("sizheng", keys)


if __name__ == "__main__":
    unittest.main()
