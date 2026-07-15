from __future__ import annotations

from PySide6.QtCore import QTimer, Qt, QUrl
from PySide6.QtGui import QCloseEvent, QDesktopServices
from PySide6.QtWidgets import (
    QButtonGroup,
    QFrame,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from qlu_toolbox import __version__
from qlu_toolbox.core.paths import AppPaths
from qlu_toolbox.core.settings import AppSettings, SettingsStore
from qlu_toolbox.core.tasks import TaskStore
from qlu_toolbox.core.tools import ToolRegistry
from qlu_toolbox.core.update import ReleaseInfo, UpdateChecker
from qlu_toolbox.modules.grade_export import MANIFEST as GRADE_EXPORT_MANIFEST
from qlu_toolbox.modules.grade_export.page import GradeExportPage

from .pages import AboutPage, HomePage, SettingsPage, TasksPage, ToolsPage


class MainWindow(QMainWindow):
    PAGE_HOME = 0
    PAGE_TOOLS = 1
    PAGE_TASKS = 2
    PAGE_SETTINGS = 3
    PAGE_ABOUT = 4
    PAGE_GRADE_EXPORT = 5

    def __init__(
        self,
        paths: AppPaths,
        settings: AppSettings,
        settings_store: SettingsStore,
        tasks: TaskStore,
        registry: ToolRegistry,
    ) -> None:
        super().__init__()
        self.paths = paths
        self.settings = settings
        self.settings_store = settings_store
        self.tasks = tasks
        self.registry = registry
        self.update_check_is_manual = False
        self.update_checker = UpdateChecker(__version__, self)
        self.update_checker.update_available.connect(self._show_update_available)
        self.update_checker.up_to_date.connect(self._show_up_to_date)
        self.update_checker.check_failed.connect(self._show_update_error)
        self.setWindowTitle("QLU 工具箱")
        self.resize(1180, 760)
        self.setMinimumSize(1000, 660)
        self._build_ui()
        QTimer.singleShot(150, self._show_welcome_if_needed)

    def _build_ui(self) -> None:
        root = QFrame()
        root.setObjectName("AppRoot")
        root.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        root_layout = QHBoxLayout(root)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)
        root_layout.addWidget(self._build_sidebar())

        self.stack = QStackedWidget()
        self.stack.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.home_page = HomePage(self.registry, self.tasks)
        self.tools_page = ToolsPage(self.registry)
        self.tasks_page = TasksPage(self.tasks)
        self.settings_page = SettingsPage(
            self.settings, self.settings_store, self.paths, self.tasks
        )
        self.about_page = AboutPage()
        self.grade_page = GradeExportPage(self.settings, self.settings_store, self.tasks)

        self.home_page.open_tool.connect(self.open_tool)
        self.tools_page.open_tool.connect(self.open_tool)
        self.grade_page.task_changed.connect(self._refresh_task_views)
        self.settings_page.settings_saved.connect(self._theme_changed)
        self.settings_page.check_updates_requested.connect(
            lambda: self._check_for_updates(manual=True)
        )

        for page in (
            self.home_page,
            self.tools_page,
            self.tasks_page,
            self.settings_page,
            self.about_page,
            self.grade_page,
        ):
            self.stack.addWidget(page)
        root_layout.addWidget(self.stack, 1)
        self.setCentralWidget(root)
        self.nav_buttons[self.PAGE_HOME].setChecked(True)
        self.stack.setCurrentIndex(self.PAGE_HOME)

    def _build_sidebar(self) -> QWidget:
        sidebar = QFrame()
        sidebar.setObjectName("Sidebar")
        sidebar.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        sidebar.setFixedWidth(232)
        layout = QVBoxLayout(sidebar)
        layout.setContentsMargins(18, 22, 18, 16)
        layout.setSpacing(8)

        brand_row = QHBoxLayout()
        mark = QLabel()
        mark.setObjectName("BrandLogo")
        mark.setPixmap(self.windowIcon().pixmap(48, 48))
        mark.setAlignment(Qt.AlignmentFlag.AlignCenter)
        mark.setFixedSize(48, 48)
        brand_text = QVBoxLayout()
        name = QLabel("QLU 工具箱")
        name.setObjectName("BrandName")
        hint = QLabel("学生校园效率工具")
        hint.setObjectName("BrandHint")
        brand_text.addWidget(name)
        brand_text.addWidget(hint)
        brand_row.addWidget(mark)
        brand_row.addLayout(brand_text)
        layout.addLayout(brand_row)
        layout.addSpacing(18)

        self.nav_group = QButtonGroup(self)
        self.nav_group.setExclusive(True)
        self.nav_buttons: dict[int, QPushButton] = {}
        for page_index, text in (
            (self.PAGE_HOME, "首页"),
            (self.PAGE_TOOLS, "全部工具"),
            (self.PAGE_TASKS, "任务记录"),
            (self.PAGE_SETTINGS, "设置"),
            (self.PAGE_ABOUT, "关于"),
        ):
            button = QPushButton(text)
            button.setCheckable(True)
            button.setProperty("nav", True)
            button.clicked.connect(lambda _checked=False, index=page_index: self.navigate(index))
            self.nav_group.addButton(button)
            self.nav_buttons[page_index] = button
            layout.addWidget(button)
        layout.addStretch()
        footer = QFrame()
        footer.setObjectName("SidebarFooter")
        footer_layout = QVBoxLayout(footer)
        footer_layout.setContentsMargins(12, 10, 12, 10)
        footer_layout.setSpacing(3)
        disclaimer = QLabel("非学校官方软件\n仅供个人学习交流使用")
        disclaimer.setObjectName("Muted")
        disclaimer.setAlignment(Qt.AlignmentFlag.AlignCenter)
        footer_layout.addWidget(disclaimer)
        version = QLabel(f"v{__version__}")
        version.setObjectName("Muted")
        version.setAlignment(Qt.AlignmentFlag.AlignCenter)
        footer_layout.addWidget(version)
        layout.addWidget(footer)
        return sidebar

    def navigate(self, index: int) -> None:
        if index == self.PAGE_HOME:
            self.home_page.refresh()
        elif index == self.PAGE_TASKS:
            self.tasks_page.refresh()
        self.stack.setCurrentIndex(index)
        self.stack.update()
        self.centralWidget().update()
        if index in self.nav_buttons:
            self.nav_buttons[index].setChecked(True)
        else:
            checked = self.nav_group.checkedButton()
            if checked:
                self.nav_group.setExclusive(False)
                checked.setChecked(False)
                self.nav_group.setExclusive(True)

    def open_tool(self, tool_id: str) -> None:
        if tool_id == GRADE_EXPORT_MANIFEST.id:
            self.grade_page.output.setText(self.settings.default_output_dir)
            self.navigate(self.PAGE_GRADE_EXPORT)

    def _refresh_task_views(self) -> None:
        self.home_page.refresh()
        self.tasks_page.refresh()

    def _theme_changed(self, theme: str) -> None:
        from .styles import stylesheet

        app = self.application_instance()
        if app:
            app.setStyleSheet(stylesheet(theme))

    @staticmethod
    def application_instance():
        from PySide6.QtWidgets import QApplication

        return QApplication.instance()

    def _show_welcome_if_needed(self) -> None:
        if not self.settings.welcome_accepted:
            box = QMessageBox(self)
            box.setWindowTitle("欢迎使用 QLU 工具箱")
            box.setIcon(QMessageBox.Icon.Information)
            box.setText("欢迎使用 QLU 工具箱")
            box.setInformativeText(
                "本项目不是齐鲁工业大学官方软件，仅供个人学习、交流用途。\n\n"
                "登录操作由你在教务系统浏览器页面中完成；工具箱不会要求你填写账号密码或验证码。\n\n"
                "默认会在启动后访问 GitHub 检查公开的新版本，不会发送账号、成绩、任务记录或设备标识；"
                "可随时在设置中关闭。\n\n"
                "本软件按所使用接口现状提供。请仅处理本人有权访问的数据，并自行核对导出结果。"
            )
            box.setStandardButtons(QMessageBox.StandardButton.Ok)
            box.button(QMessageBox.StandardButton.Ok).setText("我已了解")
            box.exec()
            self.settings.welcome_accepted = True
            self.settings_store.save(self.settings)
        if self.settings.check_updates:
            QTimer.singleShot(1_000, self._check_for_updates)

    def _check_for_updates(self, manual: bool = False) -> None:
        if self.update_checker.check():
            self.update_check_is_manual = manual
        elif manual:
            QMessageBox.information(self, "正在检查更新", "更新检查正在进行，请稍候。")

    def _show_update_available(self, release: ReleaseInfo) -> None:
        self.update_check_is_manual = False
        box = QMessageBox(self)
        box.setWindowTitle("发现新版本")
        box.setIcon(QMessageBox.Icon.Information)
        box.setText(f"QLU 工具箱 {release.version} 已发布")
        notes = release.notes.strip()
        if len(notes) > 800:
            notes = notes[:800].rstrip() + "…"
        box.setInformativeText(notes)
        view_button = box.addButton("查看并下载", QMessageBox.ButtonRole.AcceptRole)
        box.addButton("稍后提醒", QMessageBox.ButtonRole.RejectRole)
        box.exec()
        if box.clickedButton() is view_button:
            QDesktopServices.openUrl(QUrl(release.url))

    def _show_up_to_date(self) -> None:
        if self.update_check_is_manual:
            QMessageBox.information(
                self,
                "已是最新版本",
                f"当前版本 v{__version__} 已是最新版本。",
            )
        self.update_check_is_manual = False

    def _show_update_error(self, message: str) -> None:
        if self.update_check_is_manual:
            QMessageBox.warning(
                self,
                "检查更新失败",
                f"暂时无法连接 GitHub，请稍后重试。\n\n{message}",
            )
        self.update_check_is_manual = False

    def closeEvent(self, event: QCloseEvent) -> None:
        if self.grade_page.request_close():
            event.accept()
        else:
            event.ignore()
