"""分项成绩导出工具。"""

from lumatile.core.tools import ToolManifest


MANIFEST = ToolManifest(
    id="grade-export",
    name="分项成绩导出",
    description="登录教务系统后，将指定学期的分项成绩导出为 Excel。",
    category="教务工具",
    version="1.0.0",
    icon_text="绩",
)

