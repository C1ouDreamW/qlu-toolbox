"""绩点计算器工具。"""

from lumatile.core.tools import ToolManifest


MANIFEST = ToolManifest(
    id="gpa-calculator",
    name="绩点计算器",
    description="导入分项成绩 Excel，自由选择课程并计算加权平均绩点。",
    category="教务工具",
    version="1.0.0",
    icon_text="GPA",
)
