from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from lumatile import __version__


def load_build_information() -> dict:
    file = Path(__file__).with_name("build-info.json")
    if not file.exists():
        if getattr(sys, "frozen", False):
            raise RuntimeError("Packaged worker is missing its build information")
        # Direct source execution must never silently open the Stable data directory.
        return {
            "channel": "debug", "version": __version__, "productName": "LumaTile Debug",
            "dataNamespace": "LumaTile-Debug", "updatesEnabled": False, "telemetryEnabled": False,
            "commit": None,
        }
    info = json.loads(file.read_text(encoding="utf-8"))
    channel = info.get("channel")
    namespaces = {"stable": "QLUToolbox", "alpha": "LumaTile-Alpha", "debug": "LumaTile-Debug"}
    if channel not in namespaces or info.get("schemaVersion") != 1 or info.get("platform") not in {"windows", "macos"}:
        raise RuntimeError("Invalid worker build information")
    if info.get("version") != __version__ or info.get("dataNamespace") != namespaces[channel]:
        raise RuntimeError("Worker build version or data namespace mismatch")
    suffix = "" if channel == "stable" else f".{channel}"
    if info.get("applicationId") != f"student.qlu.toolbox{suffix}":
        raise RuntimeError("Worker application identity mismatch")
    if info.get("updatesEnabled") is not (channel != "debug") or info.get("telemetryEnabled") is not (channel == "stable"):
        raise RuntimeError("Worker channel policy mismatch")
    if info.get("commit") is not None and not re.fullmatch(r"[a-f0-9]{40}", str(info["commit"])):
        raise RuntimeError("Invalid worker source commit")
    return info
