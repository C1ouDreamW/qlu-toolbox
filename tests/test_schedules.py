from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from qlu_toolbox.core.paths import AppPaths
from qlu_toolbox.core.schedules import (
    MAX_PAYLOAD_BYTES,
    ScheduleStore,
    ScheduleValidationError,
    validate_payload,
)


def make_paths(root: Path) -> AppPaths:
    return AppPaths(
        config_dir=root / "config",
        data_dir=root / "data",
        log_dir=root / "data" / "logs",
        profile_dir=root / "data" / "profiles",
        browser_dir=root / "data" / "browsers",
    )


def payload(name: str = "高等数学") -> str:
    return json.dumps({
        "schemaVersion": 1,
        "id": "ignored",
        "name": name,
        "courses": [{"id": "course-1", "name": name}],
    }, ensure_ascii=False)


class ScheduleStoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.paths = make_paths(Path(self.temporary.name))
        self.store = ScheduleStore(self.paths)

    def tearDown(self):
        self.temporary.cleanup()

    def test_save_creates_active_row_and_lists_it_first(self):
        saved = self.store.save("schedule-1", "我的课表", payload(), make_active=True)
        self.assertTrue(saved["isActive"])
        rows = self.store.list_schedules()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["name"], "我的课表")
        self.assertTrue(self.store.path.exists())
        stored = json.loads(self.store.path.read_text(encoding="utf-8"))
        self.assertEqual(stored["schemaVersion"], 1)

    def test_save_with_make_active_demotes_other_rows(self):
        self.store.save("schedule-1", "课表一", payload(), make_active=True)
        self.store.save("schedule-2", "课表二", payload(), make_active=True)
        rows = self.store.list_schedules()
        active = [row for row in rows if row["isActive"]]
        self.assertEqual([row["id"] for row in active], ["schedule-2"])

    def test_first_save_becomes_active_without_make_active(self):
        self.store.save("schedule-1", "课表一", payload(), make_active=False)
        rows = self.store.list_schedules()
        self.assertTrue(rows[0]["isActive"])

    def test_activate_switches_and_reorders_active_first(self):
        self.store.save("schedule-1", "课表一", payload(), make_active=True)
        self.store.save("schedule-2", "课表二", payload(), make_active=False)
        self.assertTrue(self.store.activate("schedule-2"))
        rows = self.store.list_schedules()
        self.assertEqual(rows[0]["id"], "schedule-2")
        self.assertTrue(rows[0]["isActive"])
        self.assertFalse(any(row["isActive"] and row["id"] == "schedule-1" for row in rows))

    def test_activate_missing_schedule_raises(self):
        with self.assertRaises(ScheduleValidationError):
            self.store.activate("missing")

    def test_delete_promotes_first_remaining_when_active_removed(self):
        self.store.save("schedule-1", "课表一", payload(), make_active=True)
        self.store.save("schedule-2", "课表二", payload(), make_active=False)
        self.assertTrue(self.store.delete("schedule-1"))
        rows = self.store.list_schedules()
        self.assertEqual([row["id"] for row in rows], ["schedule-2"])
        self.assertTrue(rows[0]["isActive"])

    def test_delete_missing_schedule_raises(self):
        with self.assertRaises(ScheduleValidationError):
            self.store.delete("missing")

    def test_save_rejects_empty_name_and_truncates_long_name(self):
        with self.assertRaises(ScheduleValidationError):
            self.store.save("schedule-1", "   ", payload(), make_active=False)
        saved = self.store.save("schedule-1", "课" * 121, payload(), make_active=False)
        self.assertEqual(len(str(saved["name"])), 120)

    def test_save_rejects_invalid_payload(self):
        with self.assertRaises(ScheduleValidationError):
            self.store.save("schedule-1", "课表", "{not json", make_active=False)
        with self.assertRaises(ScheduleValidationError):
            self.store.save("schedule-1", "课表", json.dumps({"schemaVersion": 9, "courses": []}), make_active=False)
        with self.assertRaises(ScheduleValidationError):
            self.store.save("schedule-1", "课表", json.dumps({"schemaVersion": 1, "name": "x"}), make_active=False)

    def test_save_rejects_oversized_payload(self):
        oversized = payload() + " " * (MAX_PAYLOAD_BYTES + 1)
        with self.assertRaises(ScheduleValidationError):
            self.store.save("schedule-1", "课表", oversized, make_active=False)

    def test_validate_payload_rejects_non_string_json(self):
        with self.assertRaises(ScheduleValidationError):
            validate_payload(json.dumps([1, 2, 3]))

    def test_corrupt_file_is_backed_up_and_store_starts_empty(self):
        self.store.save("schedule-1", "课表一", payload(), make_active=True)
        self.store.path.write_text("{broken", encoding="utf-8")
        self.assertEqual(self.store.list_schedules(), [])
        backup = self.store.path.with_suffix(".json.broken")
        self.assertTrue(backup.exists())
        self.assertIn("broken", backup.read_text(encoding="utf-8"))

    def test_storage_with_unexpected_shape_is_backed_up(self):
        self.store.path.parent.mkdir(parents=True, exist_ok=True)
        self.store.path.write_text(json.dumps({"schemaVersion": 1, "schedules": "nope"}), encoding="utf-8")
        self.assertEqual(self.store.list_schedules(), [])
        self.assertTrue(self.store.path.with_suffix(".json.broken").exists())

    def test_rows_missing_id_are_dropped_to_backup(self):
        self.store.path.parent.mkdir(parents=True, exist_ok=True)
        row = {"name": "课表", "payload": payload(), "updatedAt": "", "isActive": False}
        self.store.path.write_text(json.dumps({"schemaVersion": 1, "schedules": [row]}), encoding="utf-8")
        self.assertEqual(self.store.list_schedules(), [])
        self.assertTrue(self.store.path.with_suffix(".json.broken").exists())

    def test_payload_stays_opaque_round_trip(self):
        raw = payload(name="大学物理◇实验")
        self.store.save("schedule-1", "课表一", raw, make_active=True)
        rows = self.store.list_schedules()
        self.assertEqual(rows[0]["payload"], raw)


if __name__ == "__main__":
    unittest.main()
