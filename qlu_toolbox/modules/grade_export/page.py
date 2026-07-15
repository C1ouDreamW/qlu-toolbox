from __future__ import annotations

import json
import os
import sys
import tempfile
import uuid
from pathlib import Path

from PySide6.QtCore import QProcess, QProcessEnvironment, QTimer, Qt, Signal
from PySide6.QtGui import QDesktopServices
from PySide6.QtCore import QUrl
from PySide6.QtWidgets import (
    QButtonGroup,
    QComboBox,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPlainTextEdit,
    QProgressBar,
    QPushButton,
    QSplitter,
    QVBoxLayout,
    QWidget,
)

from qlu_toolbox.core.settings import AppSettings, SettingsStore
from qlu_toolbox.core.tasks import TaskStore
from qlu_toolbox.ui.pages import page_header

from . import MANIFEST
from .domain import SEMESTERS, default_academic_year, validate_academic_year
from .service import STAGES


class WorkerProcess(QWidget):
    event_received = Signal(dict)
    process_failed = Signal(str)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.process = QProcess(self)
        self.buffer = b""
        self.event_file_buffer = b""
        self.event_file_offset = 0
        self.event_path: Path | None = None
        self.seen_event_sequences: set[int] = set()
        self.terminal_event_received = False
        self.event_timer = QTimer(self)
        self.event_timer.setInterval(100)
        self.event_timer.timeout.connect(self._read_event_file)
        self.process.readyReadStandardOutput.connect(self._read_stdout)
        self.process.readyReadStandardError.connect(self._read_stderr)
        self.process.finished.connect(self._finished)
        self.process.errorOccurred.connect(self._process_error)

    def start(
        self,
        year: str,
        semester: str,
        output_dir: str,
        browser: str,
        keep_login: bool,
    ) -> None:
        self._cleanup_event_file()
        self.buffer = b""
        self.event_file_buffer = b""
        self.event_file_offset = 0
        self.seen_event_sequences.clear()
        self.terminal_event_received = False
        event_dir = Path(tempfile.gettempdir()) / "QLUToolbox" / "ipc"
        event_dir.mkdir(parents=True, exist_ok=True)
        self.event_path = event_dir / f"grade-export-{uuid.uuid4().hex}.jsonl"
        environment = QProcessEnvironment.systemEnvironment()
        environment.insert("PYTHONUTF8", "1")
        self.process.setProcessEnvironment(environment)
        self.process.setProgram(sys.executable)
        arguments = self._entry_arguments() + [
            "--worker",
            "grade-export",
            "--year",
            year,
            "--semester",
            semester,
            "--output",
            output_dir,
            "--browser",
            browser,
            "--keep-login",
            "yes" if keep_login else "no",
            "--event-file",
            str(self.event_path),
        ]
        self.process.setArguments(arguments)
        self.event_timer.start()
        self.process.start()

    @staticmethod
    def _entry_arguments() -> list[str]:
        project_root = Path(__file__).resolve().parents[3]
        source_entry = project_root / "main.py"
        if getattr(sys, "frozen", False) or "__compiled__" in globals() or not source_entry.exists():
            return []
        return [str(source_entry)]

    def continue_after_login(self) -> None:
        self._send_command("continue")

    def cancel(self) -> None:
        if self.process.state() == QProcess.ProcessState.NotRunning:
            return
        self._send_command("cancel")
        QTimer.singleShot(5000, self._force_stop_if_running)

    def _send_command(self, command: str) -> None:
        payload = json.dumps({"command": command}, ensure_ascii=False) + "\n"
        self.process.write(payload.encode("utf-8"))

    def _force_stop_if_running(self) -> None:
        if self.process.state() != QProcess.ProcessState.NotRunning:
            self.process.terminate()
            QTimer.singleShot(2000, self._kill_if_running)

    def _kill_if_running(self) -> None:
        if self.process.state() != QProcess.ProcessState.NotRunning:
            self.process.kill()

    def _read_stdout(self) -> None:
        self.buffer += bytes(self.process.readAllStandardOutput())
        self.buffer = self._consume_event_lines(self.buffer)

    def _read_event_file(self) -> None:
        if self.event_path is None or not self.event_path.exists():
            return
        try:
            with self.event_path.open("rb") as handle:
                handle.seek(self.event_file_offset)
                content = handle.read()
        except OSError:
            return
        if not content:
            return
        self.event_file_offset += len(content)
        self.event_file_buffer += content
        self.event_file_buffer = self._consume_event_lines(self.event_file_buffer)

    def _consume_event_lines(self, buffer: bytes) -> bytes:
        while b"\n" in buffer:
            raw, buffer = buffer.split(b"\n", 1)
            if not raw.strip():
                continue
            try:
                event = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                continue
            self._dispatch_event(event)
        return buffer

    def _dispatch_event(self, event: dict) -> None:
        sequence = event.get("_seq")
        if isinstance(sequence, int):
            if sequence in self.seen_event_sequences:
                return
            self.seen_event_sequences.add(sequence)
        if event.get("type") in {"success", "error", "cancelled"}:
            self.terminal_event_received = True
        self.event_received.emit(event)

    def _read_stderr(self) -> None:
        message = bytes(self.process.readAllStandardError()).decode("utf-8", errors="replace").strip()
        if message:
            self.event_received.emit({"type": "log", "message": message})

    def _finished(self, exit_code: int, _status) -> None:
        self._read_stdout()
        self._read_event_file()
        self.event_timer.stop()
        if not self.terminal_event_received:
            self.process_failed.emit(f"后台任务异常结束（退出码 {exit_code}）")
        self._cleanup_event_file()

    def _process_error(self, _error) -> None:
        if self.process.state() == QProcess.ProcessState.NotRunning and not self.terminal_event_received:
            self.event_timer.stop()
            self.process_failed.emit(f"无法启动后台任务：{self.process.errorString()}")
            self._cleanup_event_file()

    def _cleanup_event_file(self) -> None:
        if self.event_path is not None:
            try:
                self.event_path.unlink(missing_ok=True)
            except OSError:
                pass
        self.event_path = None


class GradeExportPage(QFrame):
    task_changed = Signal()

    def __init__(
        self,
        settings: AppSettings,
        settings_store: SettingsStore,
        tasks: TaskStore,
    ) -> None:
        super().__init__()
        self.setObjectName("ContentPage")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.settings = settings
        self.settings_store = settings_store
        self.tasks = tasks
        self.task_id: str | None = None
        self.result_path: Path | None = None
        self.running = False
        self.current_stage = "environment"
        self.runner = WorkerProcess(self)
        self.runner.event_received.connect(self._handle_event)
        self.runner.process_failed.connect(self._worker_failed)
        self._build_ui()

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(34, 30, 34, 30)
        layout.setSpacing(16)
        title, subtitle = page_header(
            "分项成绩导出",
            "账号信息不会由工具箱收集。<b>开始前请确保你已经登录aTrust VPN或校园网，并关闭其他无关代理软件。</b>",
        )
        layout.addWidget(title)
        layout.addWidget(subtitle)

        splitter = QSplitter(Qt.Orientation.Horizontal)
        splitter.setChildrenCollapsible(False)
        splitter.addWidget(self._build_form_card())
        splitter.addWidget(self._build_status_card())
        splitter.setSizes([470, 550])
        layout.addWidget(splitter, 1)

    def _build_form_card(self) -> QWidget:
        card = QFrame()
        card.setObjectName("Card")
        layout = QVBoxLayout(card)
        layout.setContentsMargins(24, 22, 24, 22)
        layout.setSpacing(12)
        heading = QLabel("导出设置")
        heading.setObjectName("SectionHeading")
        layout.addWidget(heading)
        hint = QLabel("选择需要查询的成绩范围和文件保存位置。")
        hint.setObjectName("Muted")
        layout.addWidget(hint)
        layout.addSpacing(8)
        layout.addWidget(QLabel("学年"))
        self.year = QComboBox()
        start_year = int(default_academic_year())
        self.year.addItems([f"{value}-{value + 1}" for value in range(start_year, start_year - 10, -1)])
        layout.addWidget(self.year)
        layout.addWidget(QLabel("学期"))
        semester_row = QHBoxLayout()
        self.semester_group = QButtonGroup(self)
        for label, value in (("第一学期", "1"), ("第二学期", "2")):
            button = QPushButton(label)
            button.setCheckable(True)
            button.setProperty("segment", True)
            button.setProperty("semester", value)
            self.semester_group.addButton(button)
            semester_row.addWidget(button)
            if value == "2":
                button.setChecked(True)
        layout.addLayout(semester_row)
        layout.addWidget(QLabel("保存位置"))
        output_row = QHBoxLayout()
        self.output = QLineEdit(self.settings.default_output_dir)
        browse = QPushButton("浏览")
        browse.clicked.connect(self._browse)
        output_row.addWidget(self.output, 1)
        output_row.addWidget(browse)
        layout.addLayout(output_row)
        privacy = QLabel("隐私提示：密码和验证码只在教务系统浏览器页面中填写。")
        privacy.setWordWrap(True)
        privacy.setObjectName("InfoBanner")
        layout.addWidget(privacy)
        layout.addStretch()
        self.start_button = QPushButton("开始导出成绩")
        self.start_button.setProperty("primary", True)
        self.start_button.setMinimumHeight(42)
        self.start_button.clicked.connect(self._start)
        layout.addWidget(self.start_button)
        return card

    def _build_status_card(self) -> QWidget:
        card = QFrame()
        card.setObjectName("Card")
        layout = QVBoxLayout(card)
        layout.setContentsMargins(24, 22, 24, 22)
        layout.setSpacing(12)
        heading = QLabel("任务状态")
        heading.setObjectName("SectionHeading")
        layout.addWidget(heading)
        self.status = QLabel("准备就绪")
        self.status.setWordWrap(True)
        self.status.setObjectName("TaskStatus")
        self.status.setProperty("status", "idle")
        layout.addWidget(self.status)
        self.progress = QProgressBar()
        self.progress.setRange(0, len(STAGES))
        self.progress.setValue(0)
        self.progress.setTextVisible(False)
        layout.addWidget(self.progress)
        self.step_labels: dict[str, QLabel] = {}
        for index, (stage, name) in enumerate(STAGES.items(), start=1):
            label = QLabel(f"○  {name}")
            label.setObjectName("Muted")
            label.setProperty("index", index)
            self.step_labels[stage] = label
            layout.addWidget(label)
        actions = QHBoxLayout()
        self.continue_button = QPushButton("我已登录，继续")
        self.continue_button.setEnabled(False)
        self.continue_button.clicked.connect(self._continue_after_login)
        self.cancel_button = QPushButton("取消任务")
        self.cancel_button.setProperty("danger", True)
        self.cancel_button.setEnabled(False)
        self.cancel_button.clicked.connect(self._cancel)
        actions.addWidget(self.continue_button)
        actions.addWidget(self.cancel_button)
        actions.addStretch()
        layout.addLayout(actions)
        self.details_toggle = QPushButton("显示技术详情")
        self.details_toggle.setCheckable(True)
        self.details_toggle.setProperty("quiet", True)
        self.details_toggle.toggled.connect(self._toggle_log)
        layout.addWidget(self.details_toggle, alignment=Qt.AlignmentFlag.AlignLeft)
        self.log = QPlainTextEdit()
        self.log.setReadOnly(True)
        self.log.setMaximumBlockCount(300)
        self.log.setMaximumHeight(150)
        self.log.setPlaceholderText("运行信息会显示在这里。")
        self.log.hide()
        layout.addWidget(self.log, 1)
        self.result_card = QFrame()
        self.result_card.setObjectName("SuccessBanner")
        result_layout = QVBoxLayout(self.result_card)
        result_layout.setContentsMargins(14, 12, 14, 12)
        self.result_label = QLabel()
        self.result_label.setWordWrap(True)
        result_layout.addWidget(self.result_label)
        result_actions = QHBoxLayout()
        open_file = QPushButton("打开文件")
        open_file.clicked.connect(self._open_file)
        open_folder = QPushButton("打开所在文件夹")
        open_folder.clicked.connect(self._open_folder)
        result_actions.addWidget(open_file)
        result_actions.addWidget(open_folder)
        result_actions.addStretch()
        result_layout.addLayout(result_actions)
        self.result_card.hide()
        layout.addWidget(self.result_card)
        return card

    def _browse(self) -> None:
        selected = QFileDialog.getExistingDirectory(self, "选择保存位置", self.output.text())
        if selected:
            self.output.setText(selected)

    def _selected_semester(self) -> str:
        button = self.semester_group.checkedButton()
        return str(button.property("semester")) if button else ""

    def _start(self) -> None:
        if self.running:
            return
        try:
            academic_year = validate_academic_year(self.year.currentText())
            semester = SEMESTERS[self._selected_semester()]
            output_dir = Path(self.output.text().strip()).expanduser()
            output_dir.mkdir(parents=True, exist_ok=True)
            if not output_dir.is_dir():
                raise ValueError("请选择有效的保存文件夹")
        except (KeyError, ValueError, OSError) as exc:
            QMessageBox.warning(self, "无法开始", str(exc))
            return

        semester_label = "第一学期" if self._selected_semester() == "1" else "第二学期"
        summary = f"{self.year.currentText()} · {semester_label}"
        self.task_id = self.tasks.create(MANIFEST.id, MANIFEST.name, MANIFEST.version, summary)
        self.settings.default_output_dir = str(output_dir)
        self.settings_store.save(self.settings)
        self.task_changed.emit()
        self.result_path = None
        self.result_card.hide()
        self.log.clear()
        self.running = True
        self.start_button.setEnabled(False)
        self.cancel_button.setEnabled(True)
        self.continue_button.setEnabled(False)
        self._set_status("正在启动后台任务…", "running")
        self.progress.setValue(0)
        self._update_steps("environment")
        self.runner.start(
            academic_year,
            semester,
            str(output_dir),
            self.settings.preferred_browser,
            self.settings.keep_login_state,
        )

    def _cancel(self) -> None:
        if not self.running:
            return
        self._set_status("正在取消任务…", "running")
        self.cancel_button.setEnabled(False)
        self.runner.cancel()

    def _continue_after_login(self) -> None:
        self.continue_button.setEnabled(False)
        self._set_status("正在验证登录状态…", "running")
        self.runner.continue_after_login()

    def _toggle_log(self, visible: bool) -> None:
        self.log.setVisible(visible)
        self.details_toggle.setText("收起技术详情" if visible else "显示技术详情")

    def _handle_event(self, event: dict) -> None:
        kind = event.get("type")
        if kind == "status":
            self._set_status(str(event.get("message", "正在处理…")), "running")
            stage = str(event.get("stage", ""))
            if stage in STAGES:
                self.current_stage = stage
                self._update_steps(stage)
                self.continue_button.setEnabled(stage == "login")
        elif kind == "log":
            self.log.appendPlainText(f"• {event.get('message', '')}")
        elif kind == "success":
            path = Path(str(event.get("path", "")))
            self.result_path = path
            if self.task_id:
                self.tasks.complete(self.task_id, str(path))
            self._finish("导出成功", success=True)
            self.result_label.setText(f"文件已保存到：\n{path}")
            self.result_card.show()
        elif kind == "cancelled":
            if self.task_id:
                self.tasks.cancel(self.task_id)
            self._finish(str(event.get("message", "操作已取消")))
        elif kind == "error":
            message = str(event.get("message", "导出失败"))
            if self.task_id:
                self.tasks.fail(self.task_id, message)
            if self.log.toPlainText().strip():
                self.details_toggle.setChecked(True)
            self._finish(message, failed=True)

    def _worker_failed(self, message: str) -> None:
        if not self.running:
            return
        if self.task_id:
            self.tasks.fail(self.task_id, message)
        if self.log.toPlainText().strip():
            self.details_toggle.setChecked(True)
        self._finish(message, failed=True)

    def _finish(self, message: str, *, success: bool = False, failed: bool = False) -> None:
        self.running = False
        self._set_status(message, "success" if success else "failed" if failed else "idle")
        self.start_button.setEnabled(True)
        self.cancel_button.setEnabled(False)
        self.continue_button.setEnabled(False)
        if success:
            self.progress.setValue(len(STAGES))
            for label in self.step_labels.values():
                label.setText(label.text().replace("○", "✓").replace("●", "✓"))
                label.setStyleSheet("color: #168A5B;")
        elif failed:
            current = self.step_labels.get(self.current_stage)
            if current:
                current.setText(current.text().replace("●", "×").replace("○", "×"))
                current.setStyleSheet("color: #C93838; font-weight: 700;")
        self.task_changed.emit()

    def _set_status(self, message: str, state: str) -> None:
        self.status.setText(message)
        self.status.setProperty("status", state)
        self.status.style().unpolish(self.status)
        self.status.style().polish(self.status)

    def _update_steps(self, current_stage: str) -> None:
        stages = list(STAGES)
        current_index = stages.index(current_stage)
        self.progress.setValue(current_index)
        for index, stage in enumerate(stages):
            label = self.step_labels[stage]
            name = STAGES[stage]
            if index < current_index:
                label.setText(f"✓  {name}")
                label.setStyleSheet("color: #168A5B;")
            elif index == current_index:
                label.setText(f"●  {name}")
                label.setStyleSheet("color: #1769E0; font-weight: 700;")
            else:
                label.setText(f"○  {name}")
                label.setStyleSheet("color: #7A8698;")

    def _open_file(self) -> None:
        if self.result_path and self.result_path.exists():
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(self.result_path)))

    def _open_folder(self) -> None:
        if not self.result_path:
            return
        if os.name == "nt":
            QProcess.startDetached("explorer", ["/select,", str(self.result_path)])
        else:
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(self.result_path.parent)))

    def request_close(self) -> bool:
        if not self.running:
            return True
        answer = QMessageBox.question(
            self,
            "任务仍在运行",
            "分项成绩导出仍在运行。确定取消任务并退出吗？",
        )
        if answer != QMessageBox.StandardButton.Yes:
            return False
        self.runner.cancel()
        return True
