import json
import os
import tempfile
import unittest

from scheduleapp import tasks_store


class SnapshotTests(unittest.TestCase):
    def test_forced_snapshot_keeps_exact_pre_migration_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_store, old_backups = tasks_store.STORE_PATH, tasks_store.BACKUP_DIR
            old_last = tasks_store._last_backup[0]
            try:
                tasks_store.STORE_PATH = os.path.join(tmp, "tasks_data.json")
                tasks_store.BACKUP_DIR = os.path.join(tmp, "backups")
                tasks_store._last_backup[0] = 0
                original = {"budgetData_britt": {"expenses": [{"id": 1}]}, "updated": 1}
                with open(tasks_store.STORE_PATH, "w", encoding="utf-8") as handle:
                    json.dump(original, handle)
                self.assertTrue(tasks_store.snapshot_now("before-budget-v5"))
                names = os.listdir(tasks_store.BACKUP_DIR)
                self.assertEqual(len(names), 1)
                self.assertIn("before-budget-v5", names[0])
                with open(os.path.join(tasks_store.BACKUP_DIR, names[0]), encoding="utf-8") as handle:
                    self.assertEqual(json.load(handle), original)
            finally:
                tasks_store.STORE_PATH, tasks_store.BACKUP_DIR = old_store, old_backups
                tasks_store._last_backup[0] = old_last


if __name__ == "__main__":
    unittest.main()
