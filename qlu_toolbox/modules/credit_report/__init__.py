"""学分修读情况工具。"""

from qlu_toolbox.core.tools import ToolManifest


MANIFEST = ToolManifest(
    id="credit-report",
    name="学分修读情况",
    description="登录教务系统后，对照培养方案核对综合素质选修课等学分修读情况，列出未修满的项目。",
    category="教务工具",
    version="1.0.0",
    icon_text="学",
)
