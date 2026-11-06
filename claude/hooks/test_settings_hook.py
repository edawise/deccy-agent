"""Tests for settings-hook.py: python3 -m unittest discover -s claude/hooks"""

import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("settings_hook", HERE / "settings-hook.py")
sh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sh)

GUARD = str(HERE / "deccy-guard.py")
OTHER = {"matcher": "Bash", "hooks": [{"type": "command", "command": "my-own-hook"}]}


class SettingsHook(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "sub", "settings.json")

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, data):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path, "w") as f:
            f.write(data if isinstance(data, str) else json.dumps(data))

    def read(self):
        with open(self.path) as f:
            return json.load(f)

    def ours(self, data):
        return [h for g in data.get("hooks", {}).get("PreToolUse", []) for h in g["hooks"]
                if sh.is_ours(h)]

    def test_install_creates_missing_file(self):
        sh.install(self.path, GUARD)
        data = self.read()
        self.assertEqual(len(self.ours(data)), 1)
        self.assertEqual(data["hooks"]["PreToolUse"][0]["matcher"], sh.MATCHER)

    def test_install_is_idempotent_and_keeps_other_settings(self):
        self.write({"model": "x", "permissions": {"allow": ["Bash(ls)"]},
                    "hooks": {"PreToolUse": [OTHER], "Stop": [OTHER]}})
        sh.install(self.path, GUARD)
        sh.install(self.path, "/elsewhere/claude/hooks/deccy-guard.py")  # re-point, not duplicate
        data = self.read()
        self.assertEqual(data["model"], "x")
        self.assertEqual(data["permissions"], {"allow": ["Bash(ls)"]})
        self.assertEqual(data["hooks"]["Stop"], [OTHER])
        self.assertIn(OTHER, data["hooks"]["PreToolUse"])
        self.assertEqual(len(self.ours(data)), 1)
        self.assertIn("/elsewhere/", self.ours(data)[0]["command"])

    def test_uninstall_removes_only_ours(self):
        self.write({"hooks": {"PreToolUse": [OTHER]}})
        sh.install(self.path, GUARD)
        self.assertIsNotNone(sh.uninstall(self.path))
        self.assertEqual(self.read(), {"hooks": {"PreToolUse": [OTHER]}})
        self.assertIsNone(sh.uninstall(self.path))  # nothing left to remove

    def test_uninstall_drops_empty_containers(self):
        self.write({"model": "x"})
        sh.install(self.path, GUARD)
        sh.uninstall(self.path)
        self.assertEqual(self.read(), {"model": "x"})

    def test_uninstall_missing_file(self):
        self.assertIsNone(sh.uninstall(self.path))
        self.assertFalse(os.path.exists(self.path))

    def test_refuses_invalid_json(self):
        self.write("{not json")
        with self.assertRaises(SystemExit):
            sh.install(self.path, GUARD)
        with open(self.path) as f:
            self.assertEqual(f.read(), "{not json")

    def test_empty_file(self):
        self.write("")
        sh.install(self.path, GUARD)
        self.assertEqual(len(self.ours(self.read())), 1)

    def test_writes_through_symlink(self):
        real = os.path.join(self.tmp.name, "dotfiles.json")
        with open(real, "w") as f:
            json.dump({"model": "x"}, f)
        os.makedirs(os.path.dirname(self.path))
        os.symlink(real, self.path)
        sh.install(self.path, GUARD)
        self.assertTrue(os.path.islink(self.path))
        with open(real) as f:
            self.assertEqual(len(self.ours(json.load(f))), 1)

    def test_status(self):
        self.assertIn("not registered", sh.status(self.path))
        sh.install(self.path, GUARD)
        self.assertIn("registered:", sh.status(self.path))


class HookCommand(unittest.TestCase):
    """The registered command, run by a real shell."""

    def run_cmd(self, guard, event):
        cmd = sh.hook_command(guard)
        return subprocess.run(["sh", "-c", cmd], input=json.dumps(event), text=True,
                              capture_output=True).returncode

    def test_blocks_deccy_role(self):
        ev = {"agent_type": "deccy-plan", "tool_name": "Bash", "tool_input": {"command": "rm x"}}
        self.assertEqual(self.run_cmd(GUARD, ev), 2)

    def test_allows_plain_session(self):
        ev = {"tool_name": "Bash", "tool_input": {"command": "rm x"}}
        self.assertEqual(self.run_cmd(GUARD, ev), 0)

    def test_missing_guard_fails_open(self):
        ev = {"agent_type": "deccy-plan", "tool_name": "Bash", "tool_input": {"command": "rm x"}}
        self.assertEqual(self.run_cmd("/nonexistent/deccy-guard.py", ev), 0)


if __name__ == "__main__":
    unittest.main()
