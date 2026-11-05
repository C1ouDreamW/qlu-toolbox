from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ToolManifest:
    id: str
    name: str
    description: str
    category: str
    version: str
    icon_text: str


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolManifest] = {}

    def register(self, manifest: ToolManifest) -> None:
        if manifest.id in self._tools:
            raise ValueError(f"工具 ID 重复：{manifest.id}")
        self._tools[manifest.id] = manifest

    def get(self, tool_id: str) -> ToolManifest:
        return self._tools[tool_id]

    def all(self) -> tuple[ToolManifest, ...]:
        return tuple(self._tools.values())

