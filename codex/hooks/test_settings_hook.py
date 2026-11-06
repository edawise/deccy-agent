"""Tests for settings-hook.py: python3 -m unittest discover -s codex/hooks"""

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
        self.path = os.path.join(self.tmp.name, "sub", "hooks.json")

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
        msg = sh.install(self.path, GUARD)
        data = self.read()
        self.assertEqual(len(self.ours(data)), 1)
        group = data["hooks"]["PreToolUse"][0]
        self.assertEqual(group["matcher"], sh.MATCHER)
        self.assertEqual(group["hooks"][0]["type"], "command")
        self.assertEqual(group["hooks"][0]["timeout"], sh.TIMEOUT)
        self.assertEqual(group["hooks"][0]["statusMessage"], sh.STATUS)
        self.assertIn(sh.MARKER, group["hooks"][0]["command"])
        self.assertIn(self.path, msg)
        self.assertIn(GUARD, msg)

    def test_matcher_covers_codex_tools(self):
        for tool in ("Bash", "apply_patch", "Edit", "Write", "collaborationspawn_agent",
                     "spawn_agent"):
            self.assertRegex(tool, "^(" + sh.MATCHER + ")$")

    def test_install_is_idempotent_and_keeps_other_settings(self):
        self.write({"model": "x", "description": "my hooks", "permissions": {"allow": ["Bash(ls)"]},
                    "hooks": {"PreToolUse": [OTHER], "Stop": [OTHER]}})
        sh.install(self.path, GUARD)
        sh.install(self.path, "/elsewhere/codex/hooks/deccy-guard.py")  # re-point, not duplicate
        data = self.read()
        self.assertEqual(data["model"], "x")
        self.assertEqual(data["description"], "my hooks")
        self.assertEqual(data["permissions"], {"allow": ["Bash(ls)"]})
        self.assertEqual(data["hooks"]["Stop"], [OTHER])
        self.assertIn(OTHER, data["hooks"]["PreToolUse"])
        self.assertEqual(len(self.ours(data)), 1)
        self.assertIn("/elsewhere/", self.ours(data)[0]["command"])

    def test_install_replaces_a_foreign_matcher(self):
        self.write({"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [
            {"type": "command", "command": "old " + sh.MARKER}]}]}})
        sh.install(self.path, GUARD)
        self.assertEqual(len(self.ours(self.read())), 1)

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

    def test_refuses_non_object_top_level(self):
        self.write("[]")
        with self.assertRaises(SystemExit):
            sh.install(self.path, GUARD)
        with open(self.path) as f:
            self.assertEqual(f.read(), "[]")

    def test_refuses_non_object_hooks(self):
        self.write({"hooks": []})
        with self.assertRaises(SystemExit):
            sh.install(self.path, GUARD)

    def test_refuses_non_list_pretooluse(self):
        self.write({"hooks": {"PreToolUse": {}}})
        with self.assertRaises(SystemExit):
            sh.install(self.path, GUARD)

    def test_empty_file(self):
        self.write("")
        sh.install(self.path, GUARD)
        self.assertEqual(len(self.ours(self.read())), 1)

    def test_writes_through_symlink(self):
        real = os.path.join(self.tmp.name, "dotfiles-hooks.json")
        with open(real, "w") as f:
            json.dump({"model": "x"}, f)
        os.makedirs(os.path.dirname(self.path))
        os.symlink(real, self.path)
        sh.install(self.path, GUARD)
        self.assertTrue(os.path.islink(self.path))
        with open(real) as f:
            self.assertEqual(len(self.ours(json.load(f))), 1)

    def test_preserves_file_mode(self):
        self.write({"model": "x"})
        os.chmod(self.path, 0o640)
        sh.install(self.path, GUARD)
        self.assertEqual(os.stat(self.path).st_mode & 0o777, 0o640)

    def test_status(self):
        self.assertIn("not registered", sh.status(self.path))
        self.assertFalse(os.path.exists(self.path))
        sh.install(self.path, GUARD)
        self.assertIn("registered:", sh.status(self.path))

    def test_status_tolerates_malformed_hooks(self):
        self.write({"hooks": []})
        self.assertIn("not registered", sh.status(self.path))
        self.write({"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": "nope"}]}})
        self.assertIn("not registered", sh.status(self.path))

    def test_cli(self):
        env = dict(os.environ, PYTHONPATH="")
        script = str(HERE / "settings-hook.py")
        out = subprocess.run(["python3", script, "install", self.path, GUARD], env=env,
                             text=True, capture_output=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("registered", out.stdout)
        out = subprocess.run(["python3", script, "status", self.path], env=env,
                             text=True, capture_output=True)
        self.assertIn("registered:", out.stdout)
        out = subprocess.run(["python3", script, "uninstall", self.path], env=env,
                             text=True, capture_output=True)
        self.assertIn("removed", out.stdout)
        self.assertEqual(self.read(), {})


class HookCommand(unittest.TestCase):
    """The registered command, run by a real shell, with the Codex guard."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def run_cmd(self, guard, event, **env_extra):
        cmd = sh.hook_command(guard)
        env = dict(os.environ)
        env.pop("DECCY_ROLE", None)
        env.update({"DECCY_GUARD_ROOT": os.path.join(self.tmp.name, "agent"),
                    "DECCY_STATE": os.path.join(self.tmp.name, "state")})
        env.update(env_extra)
        return subprocess.run(["sh", "-c", cmd], input=json.dumps(event), text=True,
                              capture_output=True, env=env)

    def test_blocks_root_role(self):
        ev = {"agent_type": "default", "session_id": "s", "tool_name": "Bash",
              "tool_input": {"command": "rm x"}}
        self.assertEqual(self.run_cmd(GUARD, ev, DECCY_ROLE="deccy-plan").returncode, 2)

    def test_blocks_unregistered_child(self):
        ev = {"agent_type": "default", "agent_id": "a1", "session_id": "s", "tool_name": "Bash",
              "tool_input": {"command": "rm x"}}
        self.assertEqual(self.run_cmd(GUARD, ev, DECCY_ROLE="deccy-orchestrator").returncode, 2)

    def test_allows_plain_session(self):
        ev = {"agent_type": "default", "session_id": "s", "tool_name": "Bash",
              "tool_input": {"command": "rm x"}}
        # No DECCY_ROLE and no agent_id: not a deccy session, so the hook must pass it through.
        result = self.run_cmd(GUARD, ev)
        self.assertEqual(result.returncode, 0)

    def test_missing_guard_fails_open(self):
        ev = {"agent_type": "default", "session_id": "s", "tool_name": "Bash",
              "tool_input": {"command": "rm x"}}
        self.assertEqual(self.run_cmd("/nonexistent/deccy-guard.py", ev).returncode, 0)


if __name__ == "__main__":
    unittest.main()
