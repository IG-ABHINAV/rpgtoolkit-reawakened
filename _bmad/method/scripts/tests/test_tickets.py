import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "tickets.py"


class ChoreTicketTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.epic = Path(self.tmp.name) / "epic-packaging"
        self.epic.mkdir()
        (self.epic / "epic-packaging.md").write_text("---\ntype: epic\n---\n# Packaging\n", encoding="utf-8")
        self.write_entry("chore")

    def tearDown(self):
        self.tmp.cleanup()

    def write_entry(self, kind):
        (self.epic / "tickets.toml").write_text(
            f'[[entry]]\nid = 23\ntype = "{kind}"\ntitle = "CI change classifier"\n', encoding="utf-8"
        )

    def run_ticket(self, *args):
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            check=False,
            capture_output=True,
            encoding="utf-8",
        )

    def assert_chore_in_status_and_next(self, expected_state):
        status = self.run_ticket("status", str(self.epic))
        self.assertEqual(status.returncode, 0, status.stderr)
        status_rows = [row for row in json.loads(status.stdout)["tickets"] if row["ref"] == "23"]
        self.assertEqual(len(status_rows), 1)
        self.assertEqual(status_rows[0]["type"], "chore")
        self.assertEqual(status_rows[0]["state"], expected_state)

        next_result = self.run_ticket("next", str(self.epic))
        self.assertEqual(next_result.returncode, 0, next_result.stderr)
        next_payload = json.loads(next_result.stdout)
        next_rows = [
            row
            for group in ("ready_to_refine", "ready_to_start", "in_progress", "blocked")
            for row in next_payload.get(group, [])
            if row["ref"] == "23"
        ]
        self.assertEqual(len(next_rows), 1)
        self.assertEqual(next_rows[0]["type"], "chore")
        self.assertEqual(next_rows[0]["state"], expected_state)

    def test_find_pull_and_plan_join_for_chore_entry(self):
        found = self.run_ticket("find", str(self.epic), "23")
        self.assertEqual(found.returncode, 0, found.stderr)
        row = json.loads(found.stdout)
        self.assertEqual(row["type"], "chore")
        self.assertIsNone(row["story_file"])
        self.assertEqual(Path(row["plan"]).name, "chore-ci-change-classifier-plan.md")
        self.assert_chore_in_status_and_next("planned")

        pulled = self.run_ticket("pull", str(self.epic), "23")
        self.assertEqual(pulled.returncode, 0, pulled.stderr)
        leaf = self.epic / "chore-ci-change-classifier.md"
        self.assertTrue(leaf.is_file())
        found = self.run_ticket("find", str(self.epic), "23")
        self.assertEqual(found.returncode, 0, found.stderr)
        self.assertEqual(Path(json.loads(found.stdout)["story_file"]).resolve(), leaf.resolve())

        plan = self.epic / "chore-ci-change-classifier-plan.md"
        plan.write_text(
            "---\ntitle: 'CI classifier plan'\ntype: 'chore'\nticket: 23\n"
            "created: '2026-10-29'\nstatus: 'in-progress'\n---\n# Plan\n",
            encoding="utf-8",
        )
        found = self.run_ticket("find", str(self.epic), "23")
        self.assertEqual(found.returncode, 0, found.stderr)
        row = json.loads(found.stdout)
        self.assertEqual(Path(row["plan"]).resolve(), plan.resolve())
        self.assertEqual(row["status"], "in-progress")
        self.assert_chore_in_status_and_next("in-progress")

    def test_legacy_story_leaf_with_ticket_field_remains_a_leaf(self):
        self.write_entry("story")
        leaf = self.epic / "story-ci-change-classifier.md"
        leaf.write_text(
            "---\nid: 23\ntype: story\nticket: 'legacy metadata'\n"
            "title: 'CI change classifier'\n---\n# Story\n",
            encoding="utf-8",
        )
        result = self.run_ticket("find", str(self.epic), "23")
        self.assertEqual(result.returncode, 0, result.stderr)
        row = json.loads(result.stdout)
        self.assertEqual(row["type"], "story")
        self.assertEqual(Path(row["story_file"]).resolve(), leaf.resolve())

    def test_leaf_typed_plan_with_tracker_id_joins_entry(self):
        self.write_entry("bug")
        plan = self.epic / "bug-ci-change-classifier-plan.md"
        plan.write_text(
            "---\ntitle: CI change classifier\ntype: bug\nticket: '23'\n"
            "status: blocked\ntracker_id: '#1045'\n---\n# Plan\n", encoding="utf-8"
        )
        (self.epic / "tickets.toml").write_text(
            '[[entry]]\nid = 23\ntype = "bug"\ntitle = "CI change classifier"\ntracker_id = "#1045"\n',
            encoding="utf-8",
        )
        result = self.run_ticket("find", str(self.epic), "23")
        self.assertEqual(result.returncode, 0, result.stderr)
        row = json.loads(result.stdout)
        self.assertEqual(Path(row["plan"]).resolve(), plan.resolve())
        self.assertIsNone(row["story_file"])
        self.assertEqual(row["status"], "blocked")

    def test_duplicate_tracker_ids_still_fail(self):
        (self.epic / "tickets.toml").write_text(
            '[[entry]]\nid = 23\ntype = "bug"\ntitle = "First"\ntracker_id = "#1045"\n'
            '[[entry]]\nid = 24\ntype = "story"\ntitle = "Second"\n',
            encoding="utf-8",
        )
        (self.epic / "story-second.md").write_text(
            "---\nid: 24\ntype: story\nticket: 'legacy metadata'\n"
            "title: Second\ntracker_id: '#1045'\n---\n# Second\n", encoding="utf-8",
        )
        result = self.run_ticket("status", str(self.epic))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("tracker_id", result.stderr)

    def test_unknown_entry_types_remain_rejected(self):
        self.write_entry("task")
        result = self.run_ticket("find", str(self.epic), "23")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("is not one of story, spike, bug, chore", result.stderr)

if __name__ == "__main__":
    unittest.main()

