"""学分修读情况：纯逻辑层（要求树解析、归类规则、及格判定、统计引擎）。"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from qlu_toolbox.core.paths import AppPaths


PLAN_INDEX_URL = (
    "https://jw.qlu.edu.cn/jwglxt/jxzxjhgl/"
    "jxzxjhck_cxJxzxjhckIndex.html?gnmkdm=N153540&layout=default"
)
PLAN_XDYQ_URL = (
    "https://jw.qlu.edu.cn/jwglxt/jxzxjhgl/jxzxjhck_cxJxzxjhxdyqIndex.html"
)
PLAN_NODE_COURSES_URL = (
    "https://jw.qlu.edu.cn/jwglxt/jxzxjhgl/jxzxjhxfyq_cxJxzxjhxfyqKcxx.html"
)
GRADE_QUERY_URL = (
    "https://jw.qlu.edu.cn/jwglxt/cjcx/cjcx_cxXsgrcj.html?doType=query&gnmkdm=N305005"
)
ENROLL_QUERY_URL = (
    "https://jw.qlu.edu.cn/jwglxt/xkcx/xkmdcx_cxXkmdcxIndex.html?doType=query&gnmkdm=N255010"
)

SNAPSHOT_DIR_NAME = "credit-report"
RULES_FILE_NAME = "rules.json"
PLAN_SNAPSHOT_NAME = "plan_snapshot.json"
GRADES_SNAPSHOT_NAME = "grades_snapshot.json"

# 教务 JSON 里候选的字段名（不同正方版本字段不一致，依次尝试）。
SCORE_FIELD_CANDIDATES = ("zcjmc", "cj", "xmcj")
CATEGORY_FIELD_CANDIDATES = ("kclbmc", "kcflmc", "kcbdlbmc", "kcxzmc", "kclb", "kcfl", "kcxz")
NATURE_FIELD_CANDIDATES = ("kcxzmc", "kcxz", "kclbmc", "kclbdm")
CODE_FIELD_CANDIDATES = ("kch", "kcbh", "kcmc")

FAIL_WORDS = ("不及格", "缺考", "作弊", "违纪", "旷考", "取消资格", "无效", "缓考")
PASS_WORDS = ("合格", "及格", "优秀", "良好", "中等", "通过")
IN_PROGRESS_WORDS = ("在修", "未评", "暂无", "待定", "--")
ELECTIVE_MARKERS = ("选修", "公选", "任选", "通识", "素质")

CREDIT_PATTERN = re.compile(r"^\d+(?:\.\d+)?$")
HEX_ID = r"[0-9A-Fa-f]{32}"


def normalize_credit(value: Any) -> float:
    if isinstance(value, (int, float)):
        return max(0.0, float(value))
    text = str(value or "").strip()
    if CREDIT_PATTERN.match(text):
        return max(0.0, float(text))
    return 0.0


def course_field(item: dict[str, Any], candidates: tuple[str, ...]) -> str:
    for key in candidates:
        value = str(item.get(key) or "").strip()
        if value:
            return value
    return ""


@dataclass(frozen=True)
class CourseRecord:
    """一条成绩记录归一化后的结果。"""

    code: str
    name: str
    credit: float
    score_text: str
    category_text: str
    nature_text: str
    academic_year: str
    semester: str
    state: str  # passed | in_progress | failed

    @classmethod
    def from_item(cls, item: dict[str, Any]) -> "CourseRecord":
        score_text = course_field(item, SCORE_FIELD_CANDIDATES)
        if str(item.get("cjsfzf") or "").strip() == "是":
            state = "failed"  # 成绩作废
        else:
            state = classify_score(score_text)
        return cls(
            code=course_field(item, CODE_FIELD_CANDIDATES),
            name=str(item.get("kcmc") or "").strip(),
            credit=normalize_credit(item.get("xf")),
            score_text=score_text,
            category_text=course_field(item, CATEGORY_FIELD_CANDIDATES),
            nature_text=course_field(item, NATURE_FIELD_CANDIDATES),
            academic_year=str(item.get("xnm") or item.get("xnmmc") or "").strip(),
            semester=str(item.get("xqm") or item.get("xqmmc") or "").strip(),
            state=state,
        )


def classify_score(score_text: str) -> str:
    text = (score_text or "").strip()
    if not text or any(word in text for word in IN_PROGRESS_WORDS):
        return "in_progress"
    if any(word in text for word in FAIL_WORDS):
        return "failed"
    if CREDIT_PATTERN.match(text):
        return "passed" if float(text) >= 60 else "failed"
    if any(word in text for word in PASS_WORDS):
        return "passed"
    return "failed"


def is_elective_like(record: CourseRecord) -> bool:
    """未归入模块的课程，只有看起来像选修/通识课时才计入总学分。"""
    return any(marker in record.category_text or marker in record.nature_text for marker in ELECTIVE_MARKERS)


def is_general_elective(record: CourseRecord) -> bool:
    """综合素质选修课课程在成绩里表现为 公共选修课/公选/通识选修课；
    必修课和专业选修课（如大学英语、大学体育）不得计入综合素质各模块。"""
    text = f"{record.category_text} {record.nature_text}"
    if "公选" in text or "通识选修" in text:
        return True
    return "选修" in record.nature_text and "公共" in record.category_text


# ---------------------------------------------------------------------------
# 培养方案「修读要求」树解析（jxzxjhck_cxJxzxjhxdyqIndex.html 的服务端渲染模板）
# ---------------------------------------------------------------------------


@dataclass
class PlanNode:
    node_id: str
    label: str
    required: float = 0.0
    is_course_node: bool = False
    jdkcsx: str = ""
    children: list["PlanNode"] = field(default_factory=list)


def _clean_label(raw: str) -> str:
    text = raw.split('"')[0]
    text = text.replace("&nbsp;", " ")
    text = re.sub(r"\s+", "", text)
    return text.strip()


def parse_requirement_tree(html: str) -> list[PlanNode]:
    """从修读要求页 HTML 提取要求树。页面里同一棵树渲染了多个变体，按节点 id 去重。"""
    node_blocks: dict[str, dict[str, Any]] = {}
    children_map: dict[str, list[str]] = {}

    li_starts = [m.start() for m in re.finditer(rf"li id='li({HEX_ID})'", html)]
    li_starts.sort()
    for index, start in enumerate(li_starts):
        chunk = html[start : li_starts[index + 1]] if index + 1 < len(li_starts) else html[start : start + 6000]
        id_match = re.search(rf"li id='li({HEX_ID})'", chunk)
        if not id_match:
            continue
        node_id = id_match.group(1)
        if node_id in node_blocks:
            continue
        info: dict[str, Any] = {"node_id": node_id, "required": 0.0, "label": "", "is_course": False}
        title_match = re.search(rf"id='p({HEX_ID})'\s+yqzdxf='([\d.]+)'\s*>([^<]*)", chunk)
        if title_match:
            info["required"] = normalize_credit(title_match.group(2))
            info["label"] = _clean_label(title_match.group(3))
        info["is_course"] = "jdkcsx='1'" in chunk
        jdkcsx_match = re.search(r"class='more' jdkcsx='([^']*)'", chunk)
        info["jdkcsx"] = jdkcsx_match.group(1) if jdkcsx_match else ""
        parent_match = re.search(rf'appendTo\(\$\\?\("#li({HEX_ID})"\\?\)\)', chunk)
        if parent_match:
            children_map.setdefault(parent_match.group(1), []).append(node_id)
        node_blocks[node_id] = info

    def build(node_id: str) -> PlanNode:
        info = node_blocks[node_id]
        return PlanNode(
            node_id=node_id,
            label=info["label"],
            required=info["required"],
            is_course_node=info["is_course"],
            jdkcsx=info["jdkcsx"],
            children=[build(child) for child in children_map.get(node_id, [])],
        )

    all_children = {child for kids in children_map.values() for child in kids}
    roots = [node_id for node_id in node_blocks if node_id not in all_children]
    return [build(root) for root in roots]


# 培养方案模块 → 工具模块 key 的映射。
# 注意：培养方案树里的「其他模块 4」不是文字通知里的七类之一，
# 它只是"总计 10 − 前三个硬性模块 6"的兜底桶，因此不建为硬性模块。
PLAN_TOTAL_LABEL = "综合素质选修课"
PLAN_MODULE_LABELS = {
    "sizheng": ("思想政治理论",),
    "anquan": ("安全教育",),
    "yishu": ("艺术体育",),
}
PLAN_SUB_LABELS = {
    "sishi": ("四史",),
    "wenhua": ("文化",),
}
PLAN_MODULE_LABEL_TEXT = {
    "sizheng": "思想政治理论模块",
    "anquan": "安全教育模块",
    "yishu": "艺术体育模块",
    "sishi": "四史",
    "wenhua": "文化",
}


def _find_by_label(nodes: list[PlanNode], keywords: tuple[str, ...]) -> PlanNode | None:
    for node in nodes:
        if any(keyword in node.label for keyword in keywords):
            return node
    for node in nodes:
        found = _find_by_label(node.children, keywords)
        if found:
            return found
    return None


def plan_from_tree(nodes: list[PlanNode]) -> dict[str, Any] | None:
    """把要求树映射为 {total_required, modules, subs, node_ids}；找不到综合素质节点返回 None。"""
    total_node = _find_by_label(nodes, (PLAN_TOTAL_LABEL,))
    if total_node is None:
        return None

    modules: dict[str, float] = {}
    subs: dict[str, float] = {}
    node_ids: dict[str, str] = {}
    node_jdkcsx: dict[str, str] = {}

    def label_map_to(keys: dict[str, tuple[str, ...]], labels: list[PlanNode]) -> None:
        for label_node in labels:
            for key, keywords in keys.items():
                if any(keyword in label_node.label for keyword in keywords):
                    if key in modules or key in subs:
                        break
                    if keys is PLAN_MODULE_LABELS:
                        modules[key] = label_node.required
                    else:
                        subs[key] = label_node.required
                    node_ids[key] = label_node.node_id
                    node_jdkcsx[key] = label_node.jdkcsx
                    break

    label_map_to(PLAN_MODULE_LABELS, total_node.children)
    sizheng = _find_by_label(total_node.children, ("思想政治理论",))
    if sizheng is not None:
        label_map_to(PLAN_SUB_LABELS, sizheng.children)

    return {
        "source": "plan",
        "total_required": total_node.required,
        "modules": modules,
        "subs": subs,
        "node_ids": node_ids,
        "node_jdkcsx": node_jdkcsx,
        "plan_name": total_node.label,
    }


def normalize_course_name(name: str) -> str:
    """去掉括号后缀（如“（智慧树）”）和空白，用于课程名模糊匹配。"""
    text = re.sub(r"[（(][^（）()]*[）)]", "", str(name or ""))
    return re.sub(r"\s+", "", text)


# ---------------------------------------------------------------------------
# 归类规则（兜底模板 + 本地可编辑）
# ---------------------------------------------------------------------------


@dataclass
class SubRule:
    key: str
    label: str
    required: float = 0.0
    keywords: list[str] = field(default_factory=list)


@dataclass
class ModuleRule:
    key: str
    label: str
    required: float = 0.0
    art_only: bool = False
    keywords: list[str] = field(default_factory=list)
    subs: list[SubRule] = field(default_factory=list)


@dataclass
class CreditRules:
    """综合素质选修课学分要求模板（兜底，可被培养方案数据覆盖）。"""

    schema_version: int = 1
    art_major: bool = False
    total_required: float = 10.0
    modules: list[ModuleRule] = field(default_factory=list)


def default_rules() -> CreditRules:
    """24/25 级综合素质选修课最低学分要求。"""
    return CreditRules(
        modules=[
            ModuleRule(
                key="sizheng",
                label="思想政治理论模块",
                required=2.0,
                keywords=["思想政治", "思政", "四史", "文化"],
                subs=[
                    SubRule(
                        key="sishi",
                        label="四史",
                        required=1.0,
                        keywords=["四史", "党史", "新中国史", "改革开放史", "社会主义发展史"],
                    ),
                    SubRule(key="wenhua", label="文化", required=1.0, keywords=["文化"]),
                ],
            ),
            ModuleRule(
                key="anquan",
                label="安全教育模块",
                required=2.0,
                keywords=["安全", "消防", "应急", "防灾", "急救"],
            ),
            ModuleRule(
                key="yishu",
                label="艺术体育模块",
                required=2.0,
                art_only=True,
                keywords=[
                    "公共艺术", "艺术", "音乐", "美术", "摄影", "影视", "舞蹈",
                    "戏剧", "戏曲", "书法", "鉴赏", "体育", "球类", "健美", "武术",
                    "网球", "篮球", "足球", "排球", "游泳", "健身", "跆拳道", "太极",
                ],
                # 按学校规定：这 2 学分必须是公共艺术类课程，体育类不计入该下限。
                subs=[
                    SubRule(
                        key="gongyi",
                        label="公共艺术",
                        required=2.0,
                        keywords=[
                            "公共艺术", "艺术", "音乐", "美术", "摄影", "影视",
                            "舞蹈", "戏剧", "戏曲", "书法",
                        ],
                    ),
                ],
            ),
            ModuleRule(
                key="renwen",
                label="人文社科",
                keywords=["人文", "社科", "哲学", "文学", "历史", "法学", "心理"],
            ),
            ModuleRule(
                key="ziran",
                label="自然科学",
                keywords=["自然", "科学", "科普"],
            ),
            ModuleRule(
                key="jingji",
                label="经济管理",
                keywords=["经济", "管理", "金融", "会计", "创业"],
            ),
            ModuleRule(
                key="waiyu",
                label="外语",
                keywords=["外语", "英语", "日语", "俄语", "法语", "德语", "韩语", "翻译", "口语"],
            ),
        ]
    )


RULES_SCHEMA_VERSION = 1


def _sub_from_dict(data: dict[str, Any]) -> SubRule:
    return SubRule(
        key=str(data.get("key") or "sub"),
        label=str(data.get("label") or "子模块"),
        required=normalize_credit(data.get("required")),
        keywords=[str(item) for item in data.get("keywords", []) if str(item)],
    )


def normalize_rules(data: dict[str, Any]) -> dict[str, Any]:
    rules = default_rules()
    if isinstance(data, dict):
        rules.art_major = bool(data.get("art_major", False))
        total = normalize_credit(data.get("total_required"))
        rules.total_required = total if total > 0 else rules.total_required
        by_key = {
            module.get("key"): module
            for module in data.get("modules", [])
            if isinstance(module, dict)
        }
        for module in rules.modules:
            override = by_key.get(module.key)
            if not override:
                continue
            module.required = normalize_credit(override.get("required"))
            module.keywords = [
                str(item) for item in override.get("keywords", module.keywords) if str(item)
            ]
            override_subs = {
                sub.get("key"): sub for sub in override.get("subs", []) if isinstance(sub, dict)
            }
            for sub in module.subs:
                sub_override = override_subs.get(sub.key)
                if sub_override:
                    sub.required = normalize_credit(sub_override.get("required"))
    return rules_to_dict(rules)


def rules_to_dict(rules: CreditRules) -> dict[str, Any]:
    return {
        "schema_version": RULES_SCHEMA_VERSION,
        "art_major": rules.art_major,
        "total_required": rules.total_required,
        "modules": [
            {
                "key": module.key,
                "label": module.label,
                "required": module.required,
                "art_only": module.art_only,
                "keywords": module.keywords,
                "subs": [
                    {
                        "key": sub.key,
                        "label": sub.label,
                        "required": sub.required,
                        "keywords": sub.keywords,
                    }
                    for sub in module.subs
                ],
            }
            for module in rules.modules
        ],
    }


def rules_path(paths: AppPaths) -> Path:
    return paths.data_dir / SNAPSHOT_DIR_NAME / RULES_FILE_NAME


def load_rules(paths: AppPaths) -> dict[str, Any]:
    path = rules_path(paths)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError):
        return rules_to_dict(default_rules())
    return normalize_rules(data if isinstance(data, dict) else {})


def save_rules(paths: AppPaths, data: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_rules(data)
    path = rules_path(paths)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.part")
    temporary.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)
    return normalized


def rules_from_dict(data: dict[str, Any]) -> CreditRules:
    """把存储的规则 JSON 还原为 CreditRules（未知模块键忽略，缺失处用默认补齐）。"""
    normalized = normalize_rules(data)
    rules = default_rules()
    rules.art_major = bool(normalized.get("art_major", False))
    total = normalize_credit(normalized.get("total_required"))
    rules.total_required = total if total > 0 else rules.total_required
    by_key = {module["key"]: module for module in normalized.get("modules", [])}
    for module in rules.modules:
        override = by_key.get(module.key)
        if not override:
            continue
        module.required = normalize_credit(override.get("required"))
        module.keywords = [str(item) for item in override.get("keywords", []) if str(item)]
        override_subs = {sub["key"]: sub for sub in override.get("subs", [])}
        for sub in module.subs:
            sub_override = override_subs.get(sub.key)
            if sub_override:
                sub.required = normalize_credit(sub_override.get("required"))
    return rules


# ---------------------------------------------------------------------------
# 匹配与统计
# ---------------------------------------------------------------------------


def _text_hit(text: str, keywords: list[str]) -> bool:
    return bool(text) and any(keyword and keyword in text for keyword in keywords)


def match_record(record: CourseRecord, rules: CreditRules) -> tuple[str, str]:
    """关键词兜底匹配，返回 (模块 key, 子模块 key 或空串)。未匹配返回 ("", "")。"""
    for module in rules.modules:
        # 子模块关键词（如“党史”）也参与模块级匹配。
        module_keywords = module.keywords + [
            keyword for sub in module.subs for keyword in sub.keywords
        ]
        name_hit = _text_hit(record.name, module_keywords)
        category_hit = _text_hit(record.category_text, module_keywords) or _text_hit(
            record.nature_text, module_keywords
        )
        if not (name_hit or category_hit):
            continue
        if module.subs:
            for sub in module.subs:
                if _text_hit(record.name, sub.keywords) or _text_hit(record.category_text, sub.keywords):
                    return module.key, sub.key
        return module.key, ""
    return "", ""


# 官方课程映射中，子节点 key → (模块 key, 子模块 key)。
PLAN_NODE_PARENT = {
    "sishi": ("sizheng", "sishi"),
    "wenhua": ("sizheng", "wenhua"),
    "anquan": ("anquan", ""),
    "yishu": ("yishu", ""),
    "sizheng": ("sizheng", ""),
}


def _official_lookup(plan: dict[str, Any]) -> dict[str, dict[str, tuple[str, str]]]:
    """把官方课程映射编译成 code/norm_name → (module, sub) 两张表。"""
    codes: dict[str, tuple[str, str]] = {}
    names: dict[str, tuple[str, str]] = {}
    course_map = plan.get("course_map") or {}
    for node_key, courses in course_map.items():
        target = PLAN_NODE_PARENT.get(node_key, (node_key, ""))
        for course in courses:
            code = str(course.get("code") or "").strip()
            name = normalize_course_name(course.get("name") or "")
            if code:
                codes.setdefault(code, target)
            if name:
                names.setdefault(name, target)
    return {"codes": codes, "names": names}


def _empty_stat(required: float) -> dict[str, Any]:
    return {
        "required": required,
        "earned": 0.0,
        "in_progress": 0.0,
        "gap": max(0.0, required),
        "satisfied": required <= 0,
    }


def _apply_plan_overrides(rules: CreditRules, plan: dict[str, Any] | None) -> CreditRules:
    if not _plan_used(plan):
        return rules
    overrides = plan.get("modules") or {}
    for key, value in overrides.items():
        existing = next((module for module in rules.modules if module.key == key), None)
        if existing is None:
            existing = ModuleRule(
                key=key,
                label=PLAN_MODULE_LABEL_TEXT.get(key, key),
                keywords=[],
            )
            rules.modules.append(existing)
        if isinstance(value, (int, float)) and value > 0:
            existing.required = max(existing.required, float(value))
    sub_overrides = plan.get("subs") or {}
    for module in rules.modules:
        for sub in module.subs:
            value = sub_overrides.get(sub.key)
            if isinstance(value, (int, float)) and value > 0:
                sub.required = max(sub.required, float(value))
    plan_total = plan.get("total_required")
    if isinstance(plan_total, (int, float)) and plan_total > 0:
        rules.total_required = max(rules.total_required, float(plan_total))
    return rules


def _plan_used(plan: dict[str, Any] | None) -> bool:
    if not plan:
        return False
    return bool(plan.get("modules")) or plan.get("total_required") is not None


def summarize(records: list[CourseRecord], rules: CreditRules, plan: dict[str, Any] | None = None) -> dict[str, Any]:
    """汇总学分修读情况。plan 为培养方案解析结果（含官方课程映射，可为 None）。"""
    rules = _apply_plan_overrides(rules, plan)
    official = _official_lookup(plan) if _plan_used(plan) else {"codes": {}, "names": {}}

    module_stats = {module.key: _empty_stat(module.required) for module in rules.modules}
    sub_stats = {
        (module.key, sub.key): _empty_stat(sub.required)
        for module in rules.modules
        for sub in module.subs
    }
    module_courses: dict[str, list[dict[str, Any]]] = {module.key: [] for module in rules.modules}
    extra_elective: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []

    total_earned = 0.0
    total_in_progress = 0.0
    passed_codes: set[str] = set()

    def course_view(record: CourseRecord, module_key: str, source: str) -> dict[str, Any]:
        return {
            "code": record.code,
            "name": record.name,
            "credit": record.credit,
            "state": record.state,
            "score": record.score_text,
            "term": f"{record.academic_year}-{record.semester}".strip("-"),
            "module": module_key,
            "source": source,  # official | keyword | extra
        }

    for record in records:
        # 同一门课（重修、补考重录）只计一次学分。
        if record.code and record.code in passed_codes:
            continue

        module_key = sub_key = ""
        source = ""
        target = official["codes"].get(record.code) or official["names"].get(
            normalize_course_name(record.name)
        )
        if target:
            module_key, sub_key = target
            source = "official"
            if module_key not in module_stats:
                module_key = sub_key = ""
            elif not sub_key:
                # 官方映射只到模块级时，按课程名/类别关键词落到子模块（如公共艺术、四史）。
                module_rule = next((m for m in rules.modules if m.key == module_key), None)
                if module_rule:
                    for sub in module_rule.subs:
                        if _text_hit(record.name, sub.keywords) or _text_hit(
                            record.category_text, sub.keywords
                        ):
                            sub_key = sub.key
                            break
        general_elective = is_general_elective(record)
        if not module_key and general_elective:
            # 只有公选性质的课程才参与综合素质模块归类。
            module_key, sub_key = match_record(record, rules)
            if module_key:
                source = "keyword"

        counted = False
        if module_key:
            module_courses[module_key].append(course_view(record, module_key, source))
            stat = module_stats[module_key]
            if record.state == "passed":
                stat["earned"] += record.credit
            elif record.state == "in_progress":
                stat["in_progress"] += record.credit
            if sub_key:
                sub_stat = sub_stats.get((module_key, sub_key))
                if sub_stat is not None:
                    if record.state == "passed":
                        sub_stat["earned"] += record.credit
                    elif record.state == "in_progress":
                        sub_stat["in_progress"] += record.credit
            counted = True
        elif general_elective and record.state in ("passed", "in_progress"):
            # 无法归入具体模块的公选课计入总学分（对应“总计修满 10 学分”）。
            extra_elective.append(course_view(record, "", "extra"))
            counted = True
        else:
            unmatched.append(course_view(record, "", "ignored"))

        if counted and record.state == "passed":
            total_earned += record.credit
            if record.code:
                passed_codes.add(record.code)
        elif counted and record.state == "in_progress":
            total_in_progress += record.credit

    total_required = rules.total_required

    modules_view: list[dict[str, Any]] = []
    unfulfilled: list[str] = []
    for module in rules.modules:
        stat = module_stats[module.key]
        stat["gap"] = max(0.0, stat["required"] - stat["earned"])
        # art_only：仅非艺术类专业需要修公共艺术课程。
        waived = module.art_only and rules.art_major
        subs_view: list[dict[str, Any]] = []
        sub_messages: list[str] = []
        for sub in module.subs:
            sub_stat = sub_stats[(module.key, sub.key)]
            sub_stat["gap"] = max(0.0, sub_stat["required"] - sub_stat["earned"])
            sub_stat["satisfied"] = sub_stat["earned"] >= sub_stat["required"]
            subs_view.append({"key": sub.key, "label": sub.label, **sub_stat})
            if not sub_stat["satisfied"]:
                sub_messages.append(f"{sub.label}类还差 {sub_stat['gap']:g} 学分")
        if waived:
            stat["satisfied"] = True
            stat["gap"] = 0.0
        else:
            stat["satisfied"] = stat["required"] <= 0 or (
                stat["earned"] >= stat["required"]
                and all(item["satisfied"] for item in subs_view)
            )
        modules_view.append(
            {
                "key": module.key,
                "label": module.label,
                "required": stat["required"],
                "earned": stat["earned"],
                "in_progress": stat["in_progress"],
                "gap": stat["gap"],
                "satisfied": stat["satisfied"],
                "art_only": module.art_only,
                "subs": subs_view,
                "courses": module_courses[module.key],
            }
        )
        if stat["required"] > 0 and not stat["satisfied"]:
            parts = [f"{module.label}：已修 {stat['earned']:g}/{stat['required']:g} 学分"]
            if sub_messages:
                parts.append("；".join(sub_messages))
            elif stat["in_progress"] > 0:
                parts.append(f"另有 {stat['in_progress']:g} 学分在修")
            unfulfilled.append("，".join(parts))

    if total_earned < total_required:
        remaining = max(0.0, total_required - total_earned - total_in_progress)
        message = f"总学分：已修 {total_earned:g}/{total_required:g} 学分，还差 {remaining:g} 学分"
        if total_in_progress > 0:
            message += f"（另有 {total_in_progress:g} 学分在修）"
        unfulfilled.insert(0, message)

    # 推荐选课方向：优先补足硬性模块下限，其余学分七类任选。
    rec_hints = {
        "sishi": "党史、新中国史、改革开放史、社会主义发展史等课程",
        "wenhua": "文化类素质教育课程",
        "gongyi": "公共艺术类课程（体育类不计入该要求）",
        "sizheng": "思想政治理论类公选课",
        "anquan": "安全教育类公选课",
        "yishu": "艺术体育模块公选课",
    }
    recommendations: list[dict[str, Any]] = []
    hard_rec_credits = 0.0
    for module in rules.modules:
        if module.required <= 0 or (module.art_only and rules.art_major):
            continue
        stat = module_stats[module.key]
        if stat["satisfied"]:
            continue
        module_need = max(0.0, module.required - stat["earned"] - stat["in_progress"])
        sub_needs_total = 0.0
        for sub in module.subs:
            sub_stat = sub_stats[(module.key, sub.key)]
            if sub_stat["satisfied"]:
                continue
            sub_need = max(0.0, sub.required - sub_stat["earned"] - sub_stat["in_progress"])
            if sub_need > 0.005:
                recommendations.append({
                    "key": f"{module.key}.{sub.key}",
                    "label": f"{module.label}·{sub.label}",
                    "detail": rec_hints.get(sub.key, ""),
                    "credit": sub_need,
                })
                hard_rec_credits += sub_need
            sub_needs_total += sub_need
        extra_module_need = module_need - sub_needs_total
        if extra_module_need > 0.005:
            recommendations.append({
                "key": module.key,
                "label": module.label,
                "detail": rec_hints.get(module.key, "该模块公选课"),
                "credit": extra_module_need,
            })
            hard_rec_credits += extra_module_need
    flex = max(0.0, total_required - total_earned - total_in_progress - hard_rec_credits)
    if flex > 0.005:
        recommendations.append({
            "key": "flex",
            "label": "任选综合素质选修课",
            "detail": "人文社科 / 自然科学 / 经济管理 / 外语等七类任选，超出模块下限的部分也计入",
            "credit": flex,
        })

    return {
        "source": "plan" if _plan_used(plan) else "fallback",
        "art_major": rules.art_major,
        "total_required": total_required,
        "total_earned": total_earned,
        "total_in_progress": total_in_progress,
        "total_gap": max(0.0, total_required - total_earned),
        "modules": modules_view,
        "unfulfilled": unfulfilled,
        "recommendations": recommendations,
        "extra_elective": extra_elective,
        "unmatched": unmatched,
    }
