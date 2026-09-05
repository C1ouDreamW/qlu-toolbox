"""课表工具。"""

from qlu_toolbox.core.tools import ToolManifest


MANIFEST = ToolManifest(
    id="schedule",
    name="课表",
    description="导入或手工维护每周课表，查看周次课程与作息安排。",
    category="校园工具",
    version="1.0.0",
    icon_text="课",
)
