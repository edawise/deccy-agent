"""Tests for the Codex deccy guard: python3 -m unittest discover -s codex/hooks"""

from __future__ import annotations

import importlib.util
import io
import json
import os
import pathlib
import sys
import tempfile
import unittest
from contextlib import contextmanager

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("deccy_guard_codex", HERE / "deccy-guard.py")
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = os.path.realpath(self.tmp.name)
        self.agent = os.path.join(self.base, "agent")
        self.state = os.path.join(self.agent, "state")
        self.repo = os.path.join(self.base, "repo")
        os.makedirs(self.repo)
        self.saved = {k: os.environ.get(k) for k in
                      ("DECCY_GUARD_ROOT", "DECCY_AGENT_ROOT", "DECCY_STATE", "DECCY_ROLE", "HOME")}
        os.environ["DECCY_GUARD_ROOT"] = self.agent
        os.environ["DECCY_STATE"] = self.state
        self.drafts = os.path.join(self.base, ".local", "share", "deccy", "workspaces")
        os.environ["DECCY_DRAFT_ROOT"] = self.drafts
        os.environ.pop("DECCY_AGENT_ROOT", None)
        os.environ.pop("DECCY_ROLE", None)
        self.sid = "session-1"

    def tearDown(self):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.tmp.cleanup()

    @contextmanager
    def env(self, **values):
        old = {k: os.environ.get(k) for k in values}
        try:
            for key, value in values.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
            yield
        finally:
            for key, value in old.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def event(self, tool, *, agent_type=None, agent_id=None, session=None, cwd=None, **tool_input):
        event = {"session_id": session or self.sid, "tool_name": tool,
                 "tool_input": tool_input, "cwd": cwd or self.repo}
        if agent_type is not None:
            event["agent_type"] = agent_type
        if agent_id is not None:
            event["agent_id"] = agent_id
        return event

    def as_root(self, role, tool, *, session=None, **tool_input):
        """A root session: no agent_type, role from DECCY_ROLE."""
        old = os.environ.get("DECCY_ROLE")
        os.environ["DECCY_ROLE"] = role
        try:
            return guard.decide(self.event(tool, session=session, **tool_input))
        finally:
            if old is None:
                os.environ.pop("DECCY_ROLE", None)
            else:
                os.environ["DECCY_ROLE"] = old

    def as_role(self, role, tool, **tool_input):
        """An explicit role via agent_type (the Claude-compatible path)."""
        return guard.decide(self.event(tool, agent_type=role, **tool_input))

    def child(self, tool, *, agent_id="agent-1", session=None, **tool_input):
        # A real Codex child inherits DECCY_ROLE from the launcher; its own role
        # still comes from the registration map, never from the env value.
        old = os.environ.get("DECCY_ROLE")
        os.environ["DECCY_ROLE"] = "deccy-orchestrator"
        try:
            return guard.decide(self.event(tool, agent_type="default", agent_id=agent_id,
                                           session=session, **tool_input))
        finally:
            if old is None:
                os.environ.pop("DECCY_ROLE", None)
            else:
                os.environ["DECCY_ROLE"] = old

    def spawn(self, task, *, session=None):
        return self.as_root("deccy-orchestrator", "collaborationspawn_agent",
                            session=session, task_name=task)

    def register(self, task, *, agent_id="agent-1", session=None, command=None):
        return self.child("Bash", agent_id=agent_id, session=session,
                          command=command or f'"$DECCY_BIN" register {task}')

    def pending_path(self, task, *, session=None):
        return os.path.join(self.state, session or self.sid, "pending", task)

    def role_path(self, agent_id="agent-1", *, session=None):
        return os.path.join(self.state, session or self.sid, "roles", agent_id)

    def patch(self, *sections, end=True):
        text = "*** Begin Patch\n" + "\n".join(sections)
        return text + ("\n*** End Patch" if end else "")

    def ws(self, kind, *parts):
        return os.path.join(self.agent, "workspaces", kind, *parts)

    def assertAllowed(self, reason, label=""):
        self.assertIsNone(reason, label)

    def assertBlocked(self, reason, label=""):
        self.assertIsNotNone(reason, label)


class RoleResolution(Base):
    def test_no_deccy_session_is_untouched(self):
        cases = [
            self.event("Bash", command="rm -rf x"),
            self.event("Bash", agent_type="general-purpose", command="rm -rf x"),
            # a child-shaped event in a deccy-free session
            self.event("Bash", agent_type="default", agent_id="a1", command="rm -rf x"),
        ]
        for event in cases:
            self.assertAllowed(guard.decide(event))

    def test_root_role_from_env(self):
        self.assertBlocked(self.as_root("deccy-plan", "Bash", command="rm x"))
        self.assertAllowed(self.as_root("deccy-plan", "Bash", command="jj log"))
        self.assertAllowed(self.as_root("deccy-orchestrator", "Bash", command="deccy new x"))
        self.assertBlocked(self.as_root("deccy-drafter", "Bash", command="deccy new x"))

    def test_root_role_with_default_agent_type(self):
        # Codex may label the root "default" without an agent id.
        with self.env(DECCY_ROLE="deccy-plan"):
            self.assertBlocked(guard.decide(
                self.event("Bash", agent_type="default", command="rm x")))

    def test_explicit_role_from_agent_type(self):
        self.assertBlocked(self.as_role("deccy-drafter", "Bash", command="deccy new x"))
        self.assertAllowed(self.as_role("deccy-orchestrator", "Bash", command="deccy new x"))
        self.assertAllowed(self.as_role("deccy-plan", "Bash", command="jj log"))

    def test_unknown_role_passes_through(self):
        self.assertAllowed(self.as_role("deccy-admin", "Bash", command="rm x"))
        self.assertAllowed(self.as_role("general-purpose", "Bash", command="rm x"))

    def test_main_entry_point(self):
        def run(stdin):
            old_in, old_err = sys.stdin, sys.stderr
            sys.stdin, sys.stderr = io.StringIO(stdin), io.StringIO()
            try:
                return guard.main(), sys.stderr.getvalue()
            finally:
                sys.stdin, sys.stderr = old_in, old_err

        self.assertEqual(run("not json"), (0, ""))
        self.assertEqual(run("[]"), (0, ""))
        self.assertEqual(run(json.dumps({"tool_name": "Bash", "tool_input": {"command": "rm x"}})),
                         (0, ""))
        with self.env(DECCY_ROLE="deccy-plan"):
            code, err = run(json.dumps({"tool_name": "Bash", "tool_input": {"command": "rm x"}}))
        self.assertEqual(code, 2)
        self.assertIn("deccy guard", err)


class Handshake(Base):
    def test_spawn_records_every_role(self):
        for task, role in (("deccy_plan_p1", "deccy-plan"),
                           ("deccy_gate_author_g1", "deccy-gate-author"),
                           ("deccy_drafter_u1", "deccy-drafter"),
                           ("deccy_judge_u1", "deccy-judge")):
            with self.subTest(task=task):
                self.assertAllowed(self.spawn(task))
                self.assertTrue(os.path.isfile(self.pending_path(task)))
                with open(self.pending_path(task), encoding="utf-8") as f:
                    self.assertEqual(f.read().strip(), role)

    def test_spawn_rejects_malformed_names(self):
        for task in ("", "random_child", "deccy_drafter_", "deccy_drafter_x/../y",
                     "deccy-admin_u1", "deccy_drafter_u1\n", "deccy-drafter-u1",
                     " deccy_drafter_u1", "deccy_drafter_u1; rm x"):
            with self.subTest(task=task):
                self.assertBlocked(self.spawn(task))
        self.assertFalse(os.path.exists(os.path.join(self.state, self.sid, "pending")))

    def test_only_orchestrator_spawns(self):
        for role in ("deccy-plan", "deccy-gate-author", "deccy-drafter", "deccy-judge"):
            for tool in ("spawn_agent", "collaborationspawn_agent"):
                with self.subTest(role=role, tool=tool):
                    self.assertBlocked(self.as_role(role, tool, task_name="deccy_drafter_u1"))
        self.assertAllowed(self.as_role("deccy-orchestrator", "spawn_agent",
                                        task_name="deccy_drafter_u1"))

    def test_unregistered_child_is_blocked_until_register(self):
        self.assertAllowed(self.spawn("deccy_drafter_u1"))
        for tool, args in (
            ("Bash", {"command": "pwd"}),
            ("apply_patch", {"command": self.patch("*** Add File: /tmp/x", "+x")}),
            ("Skill", {"skill": "deccy-core"}),
            ("spawn_agent", {"task_name": "deccy_judge_u2"}),
            ("wait_agent", {}),
        ):
            with self.subTest(tool=tool):
                reason = self.child(tool, **args)
                self.assertBlocked(reason)
                self.assertIn("register", reason)
        self.assertAllowed(self.register("deccy_drafter_u1"))
        self.assertAllowed(self.child("Bash", command="pwd"))

    def test_register_binds_role_and_clears_pending(self):
        self.assertAllowed(self.spawn("deccy_drafter_u1"))
        self.assertAllowed(self.register("deccy_drafter_u1"))
        with open(self.role_path(), encoding="utf-8") as f:
            self.assertEqual(f.read().strip(), "deccy-drafter")
        self.assertFalse(os.path.exists(self.pending_path("deccy_drafter_u1")))
        self.assertBlocked(self.child("Bash", command="deccy new x"))
        self.assertAllowed(self.child("Bash", command="jj status"))

    def test_register_requires_pending(self):
        reason = self.register("deccy_drafter_u9")
        self.assertBlocked(reason)
        self.assertIn("no pending role", reason)
        self.assertFalse(os.path.exists(self.role_path()))

    def test_register_accepts_only_the_plain_form(self):
        forms = [
            '"$DECCY_BIN" register TASK',
            "$DECCY_BIN register TASK",
            '"${DECCY_BIN}" register TASK',
            "/opt/bundle/codex/deccy-codex register TASK",
            "deccy-codex register TASK",
            '"$DECCY_BIN" register "TASK"',
        ]
        for i, form in enumerate(forms):
            task = f"deccy_drafter_acc{i}"
            self.assertAllowed(self.spawn(task))
            command = form.replace("TASK", task)
            with self.subTest(command=command):
                self.assertAllowed(self.register(task, agent_id=f"accepted-{i}", command=command))

        task = "deccy_drafter_rej"
        self.assertAllowed(self.spawn(task))
        rejected = [
            f"env deccy-codex register {task}",
            f"deccy-codex register {task}; rm -rf x",
            f"deccy-codex register {task} && true",
            f"deccy-codex register {task} > out",
            f"deccy-codex register {task} extra",
            "deccy-codex register",
            "deccy-codex register deccy_drafter_x/../y",
            f"deccy-codex register {task} # ok",
            f"sh deccy-codex register {task}",
            f'deccy-codex register "../{task}"',
        ]
        for command in rejected:
            with self.subTest(command=command):
                reason = self.register(task, agent_id="rejected-1", command=command)
                self.assertBlocked(reason)
                self.assertIn("register", reason)
        self.assertTrue(os.path.exists(self.pending_path(task)))
        self.assertAllowed(self.register(task, agent_id="rejected-1"))

    def test_register_is_session_scoped(self):
        self.assertAllowed(self.spawn("deccy_drafter_u1", session="session-a"))
        self.assertBlocked(self.register("deccy_drafter_u1", session="session-b"))
        self.assertTrue(os.path.exists(self.pending_path("deccy_drafter_u1", session="session-a")))
        self.assertFalse(os.path.exists(self.role_path(session="session-b")))
        self.assertAllowed(self.register("deccy_drafter_u1", session="session-a"))

    def test_register_prefix_must_match_pending_role(self):
        os.makedirs(os.path.dirname(self.pending_path("deccy_drafter_u1")), exist_ok=True)
        with open(self.pending_path("deccy_drafter_u1"), "w", encoding="utf-8") as f:
            f.write("deccy-judge\n")
        reason = self.register("deccy_drafter_u1")
        self.assertBlocked(reason)
        self.assertIn("no pending role", reason)

        os.makedirs(os.path.dirname(self.pending_path("random")), exist_ok=True)
        with open(self.pending_path("random"), "w", encoding="utf-8") as f:
            f.write("deccy-drafter\n")
        self.assertBlocked(self.register("random"))

    def test_corrupt_role_file_is_unregistered(self):
        self.assertAllowed(self.spawn("deccy_drafter_u1"))
        self.assertAllowed(self.register("deccy_drafter_u1"))
        with open(self.role_path(), "w", encoding="utf-8") as f:
            f.write("deccy-admin\n")
        reason = self.child("Bash", command="pwd")
        self.assertBlocked(reason)
        self.assertIn("register", reason)

    def test_registration_write_failure_keeps_pending(self):
        self.assertAllowed(self.spawn("deccy_drafter_u1"))
        real = guard.write_role
        guard.write_role = lambda event, role: False
        try:
            reason = self.register("deccy_drafter_u1")
        finally:
            guard.write_role = real
        self.assertBlocked(reason)
        self.assertIn("could not record", reason)
        self.assertTrue(os.path.exists(self.pending_path("deccy_drafter_u1")))
        self.assertAllowed(self.register("deccy_drafter_u1"))

    def test_registered_child_cannot_reregister_or_control(self):
        self.assertAllowed(self.spawn("deccy_drafter_u1"))
        self.assertAllowed(self.register("deccy_drafter_u1"))
        self.assertBlocked(self.register("deccy_drafter_u1"))
        for tool in ("spawn_agent", "collaborationspawn_agent", "wait_agent",
                     "collaborationwait_agent", "collaborationsend_message",
                     "collaborationfollowup_task", "collaborationlist_agents",
                     "collaborationinterrupt_agent", "collaborationfrobnicate"):
            with self.subTest(tool=tool):
                self.assertBlocked(self.child(tool, task_name="deccy_judge_u2"))

    def test_orchestrator_collaboration_tools(self):
        for tool in ("wait_agent", "collaborationwait_agent", "collaborationsend_message",
                     "collaborationfollowup_task", "collaborationlist_agents",
                     "collaborationinterrupt_agent", "collaborationfrobnicate",
                     "close_agent", "resume_agent", "agent_status"):
            with self.subTest(tool=tool):
                self.assertAllowed(self.as_root("deccy-orchestrator", tool))


class State(Base):
    def test_paths_are_sanitized(self):
        path = guard.role_file({"session_id": "../../escape", "agent_id": "../../../x"})
        self.assertTrue(path.startswith(os.path.realpath(self.state) + os.sep), path)
        self.assertNotIn("..", path.split(os.sep))
        pending = guard.pending_file("../../escape", "deccy_drafter_u1")
        self.assertTrue(pending.startswith(os.path.realpath(self.state) + os.sep), pending)
        self.assertNotIn("..", pending.split(os.sep))

    def test_paths_require_identifiers(self):
        self.assertEqual(guard.role_file({}), "")
        self.assertEqual(guard.role_file({"session_id": "s"}), "")
        self.assertEqual(guard.role_file({"agent_id": "a"}), "")
        self.assertEqual(guard.pending_file("", "deccy_drafter_u1"), "")
        self.assertEqual(guard.pending_file("s", ""), "")
        self.assertEqual(guard.pending_file("s", "../x"), "")

    def test_safe_name(self):
        self.assertEqual(guard.safe_name("."), "")
        self.assertEqual(guard.safe_name(".."), "")
        self.assertEqual(guard.safe_name(""), "")
        self.assertEqual(guard.safe_name("../../x"), ".._.._x")
        self.assertEqual(guard.safe_name("a b/c"), "a_b_c")

    def test_state_root_follows_the_agent_root(self):
        with self.env(DECCY_STATE=None, DECCY_GUARD_ROOT="/x/agent"):
            self.assertEqual(guard.state_root(), "/x/agent/state")

    def test_default_paths_expand_home(self):
        with self.env(HOME=self.base, DECCY_GUARD_ROOT=None, DECCY_AGENT_ROOT=None,
                      DECCY_STATE=None):
            expected = os.path.join(self.base, ".local", "share", "deccy", "agent")
            self.assertEqual(guard.agent_root(), expected)
            self.assertEqual(guard.state_root(), os.path.join(expected, "state"))
            self.assertFalse(guard.agent_root().startswith("~"))

    def test_agent_root_precedence(self):
        with self.env(DECCY_GUARD_ROOT=self.agent, DECCY_AGENT_ROOT="/elsewhere"):
            self.assertEqual(guard.agent_root(), self.agent)
        with self.env(DECCY_GUARD_ROOT=None, DECCY_AGENT_ROOT="/elsewhere"):
            self.assertEqual(guard.agent_root(), "/elsewhere")

    def test_pending_round_trip_and_invalid_role(self):
        self.assertTrue(guard.record_pending(self.sid, "deccy_drafter_u1", "deccy-drafter"))
        self.assertEqual(guard.read_pending(self.sid, "deccy_drafter_u1"), "deccy-drafter")
        guard.clear_pending(self.sid, "deccy_drafter_u1")
        self.assertIsNone(guard.read_pending(self.sid, "deccy_drafter_u1"))

        self.assertTrue(guard.record_pending(self.sid, "deccy_drafter_u2", "deccy-admin"))
        self.assertIsNone(guard.read_pending(self.sid, "deccy_drafter_u2"))

    def test_corrupt_pending_is_ignored(self):
        os.makedirs(os.path.dirname(self.pending_path("deccy_drafter_u1")), exist_ok=True)
        with open(self.pending_path("deccy_drafter_u1"), "w", encoding="utf-8") as f:
            f.write("not-a-role\n")
        reason = self.register("deccy_drafter_u1")
        self.assertBlocked(reason)
        self.assertIn("no pending role", reason)

    def test_role_for_task(self):
        table = {
            "deccy_plan_p1": "deccy-plan",
            "deccy_gate_author_g1": "deccy-gate-author",
            "deccy_drafter_u1": "deccy-drafter",
            "deccy_judge_u1": "deccy-judge",
            "deccy_drafter_": None,
            "deccy_drafter": None,
            "deccy-admin_u1": None,
            "": None,
            "deccy_drafter_x/y": None,
        }
        for task, role in table.items():
            with self.subTest(task=task):
                self.assertEqual(guard.role_for_task(task), role)


class ApplyPatch(Base):
    def test_add_update_delete_and_move(self):
        inner = self.ws("drafts", "r", "c", "u", "a.py")
        moved = self.ws("drafts", "r", "c", "u", "b.py")
        other = self.ws("drafts", "r", "c", "u", "c.py")
        command = self.patch(
            f"*** Add File: {inner}",
            "+x = 1",
            f"*** Update File: {other}",
            "@@",
            "-old",
            "+new",
            f"*** Delete File: {other}",
            f"*** Update File: {inner}",
            f"*** Move to: {moved}",
        )
        self.assertAllowed(self.as_role("deccy-drafter", "apply_patch", command=command))

    def test_move_destination_is_checked(self):
        inner = self.ws("drafts", "r", "c", "u", "a.py")
        command = self.patch(f"*** Update File: {inner}", "*** Move to: /tmp/outside.py")
        self.assertBlocked(self.as_role("deccy-drafter", "apply_patch", command=command))
        command = self.patch(f"*** Update File: {inner}",
                             f"*** Move to: {self.ws('drafts', 'r', 'c', 'u', 'b.py')}")
        self.assertAllowed(self.as_role("deccy-drafter", "apply_patch", command=command))

    def test_move_source_is_checked(self):
        inner = self.ws("drafts", "r", "c", "u", "a.py")
        command = self.patch("*** Update File: /tmp/outside.py", f"*** Move to: {inner}")
        self.assertBlocked(self.as_role("deccy-drafter", "apply_patch", command=command))

    def test_relative_paths_resolve_against_cwd(self):
        target = self.ws("drafts", "r", "c", "u", "a.py")
        rel = os.path.relpath(target, self.repo)
        command = self.patch(f"*** Add File: {rel}", "+x")
        self.assertAllowed(self.as_role("deccy-drafter", "apply_patch", command=command,
                                        cwd=self.repo))
        escape = os.path.join("..", "..", "..", "etc", "passwd")
        command = self.patch(f"*** Add File: {escape}", "+x")
        self.assertBlocked(self.as_role("deccy-drafter", "apply_patch", command=command,
                                        cwd=self.repo))

    def test_traversal_inside_and_outside_the_scope(self):
        inside = self.ws("drafts", "r", "c", "u")
        command = self.patch(f"*** Add File: {inside}/../../../../etc/x", "+x")
        self.assertBlocked(self.as_role("deccy-drafter", "apply_patch", command=command))
        command = self.patch(f"*** Add File: {inside}/../still-inside.py", "+x")
        self.assertAllowed(self.as_role("deccy-drafter", "apply_patch", command=command))

    def test_symlink_escape_is_blocked(self):
        outside = os.path.join(self.base, "outside")
        inside = self.ws("drafts", "r", "c", "u")
        os.makedirs(outside)
        os.makedirs(inside)
        link = os.path.join(inside, "link")
        os.symlink(outside, link)
        command = self.patch(f"*** Add File: {link}/x.py", "+x")
        self.assertBlocked(self.as_role("deccy-drafter", "apply_patch", command=command))

    def test_malformed_patch_is_denied(self):
        commands = [
            "",
            "*** Begin Patch\n*** End Patch",
            "*** begin patch\n*** Add File: /tmp/x\n+x",
            "*** Add File: \n+x",
            "+x",
            "*** Begin Patch\n*** Add File: /tmp/x\n+x",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertBlocked(self.as_role("deccy-drafter", "apply_patch", command=command))
        self.assertBlocked(self.as_role("deccy-drafter", "apply_patch"))

    def test_multiple_sections_are_all_checked(self):
        inner = self.ws("drafts", "r", "c", "u", "a.py")
        command = self.patch(f"*** Add File: {inner}", "+x",
                             "*** Add File: /tmp/outside.py", "+x")
        self.assertBlocked(self.as_role("deccy-drafter", "apply_patch", command=command))

    def test_patch_field_fallback(self):
        inner = self.ws("drafts", "r", "c", "u", "a.py")
        self.assertAllowed(self.as_role("deccy-drafter", "apply_patch",
                                        patch=self.patch(f"*** Add File: {inner}", "+x")))
        self.assertBlocked(self.as_role("deccy-drafter", "apply_patch",
                                        patch=self.patch("*** Add File: /tmp/x", "+x")))

    def test_scope_matrix(self):
        plan_ok = os.path.join(self.agent, "plan", "r.plan.md")
        rounds_ok = os.path.join(self.agent, "rounds", "r", "ROUND.md")
        drafts_ok = self.ws("drafts", "r", "c", "u", "a.py")
        judge_ok = self.ws("judge", "r", "c", "u", "m.py")
        cli_draft_ok = os.path.join(self.drafts, "ns", "handle", "a.py")
        outside = os.path.join(self.repo, "src", "a.py")
        matrix = {
            "deccy-plan": (plan_ok, [rounds_ok, drafts_ok, judge_ok, cli_draft_ok, outside]),
            "deccy-orchestrator": (rounds_ok, [drafts_ok, judge_ok, cli_draft_ok, outside]),
            "deccy-gate-author": (drafts_ok, [judge_ok, outside]),
            "deccy-drafter": (drafts_ok, [judge_ok, outside]),
            "deccy-judge": (judge_ok, [drafts_ok, outside]),
        }
        for role, (allowed, denied) in matrix.items():
            with self.subTest(role=role):
                self.assertAllowed(self.as_role(role, "apply_patch",
                    command=self.patch(f"*** Add File: {allowed}", "+x")))
                for path in denied:
                    self.assertBlocked(self.as_role(role, "apply_patch",
                        command=self.patch(f"*** Add File: {path}", "+x")), path)

        self.assertAllowed(self.as_role("deccy-orchestrator", "apply_patch",
            command=self.patch(f"*** Add File: {plan_ok}", "+x")))
        for role in ("deccy-gate-author", "deccy-drafter", "deccy-judge"):
            self.assertAllowed(self.as_role(role, "apply_patch",
                command=self.patch(f"*** Add File: {cli_draft_ok}", "+x")))

    def test_plan_scope_is_one_directory_level(self):
        self.assertAllowed(self.as_role("deccy-plan", "Write",
            file_path=os.path.join(self.agent, "plan", "r1.plan.md")))
        self.assertBlocked(self.as_role("deccy-plan", "Write",
            file_path=os.path.join(self.agent, "plan", "sub", "r1.plan.md")))
        self.assertBlocked(self.as_role("deccy-plan", "Edit",
            file_path=os.path.join(self.agent, "rounds", "r1", "ROUND.md")))
        self.assertBlocked(self.as_role("deccy-plan", "Write", file_path="nodes/x.json"))
        self.assertBlocked(self.as_role("deccy-plan", "Write",
            file_path=os.path.join(self.agent, "plan", "..", "x")))

    def test_write_tool_variants(self):
        ok = self.ws("drafts", "r", "c", "u", "a.py")
        bad = "/tmp/x"
        for tool, field in (("Edit", "file_path"), ("Write", "file_path"),
                            ("MultiEdit", "file_path"), ("NotebookEdit", "notebook_path")):
            with self.subTest(tool=tool):
                self.assertAllowed(self.as_role("deccy-drafter", tool, **{field: ok}))
                self.assertBlocked(self.as_role("deccy-drafter", tool, **{field: bad}))
        self.assertBlocked(self.as_role("deccy-drafter", "Write"))

    def test_orchestrator_and_judge_writes(self):
        self.assertAllowed(self.as_role("deccy-orchestrator", "Write",
            file_path=os.path.join(self.agent, "rounds", "r1", "ROUND.md")))
        self.assertAllowed(self.as_role("deccy-orchestrator", "Write",
            file_path=os.path.join(self.agent, "plan", "r1.plan.md")))
        self.assertBlocked(self.as_role("deccy-orchestrator", "Edit",
            file_path=self.ws("drafts", "x")))
        self.assertBlocked(self.as_role("deccy-orchestrator", "Edit",
            file_path="nodes/abc.json"))
        self.assertAllowed(self.as_role("deccy-judge", "Write",
            file_path=self.ws("judge", "r", "c", "u", "cand", "m.py")))
        self.assertBlocked(self.as_role("deccy-judge", "Write",
            file_path=self.ws("drafts", "r", "c", "u", "a.py")))


class PlanShell(Base):
    R = "deccy-plan"

    def test_reads_allowed(self):
        for command in ("deccy log", "deccy show abc", "deccy validate",
                        "jj log -r 'heads(all())'", "jj workspace list", "jj st",
                        "deccy show x 2>&1 | head -50", "deccy validate 2>/dev/null",
                        "cat nodes/a.json", "jj diff --summary -r @"):
            with self.subTest(command=command):
                self.assertAllowed(self.as_role(self.R, "Bash", command=command))

    def test_writes_and_wrappers_blocked(self):
        for command in ("echo x > f", "echo x >> f", "cat a>b", "tee f", "ls | tee f",
                        "sed -i s/a/b/ f", "python3 -c 'open(1)'", "bash -c 'ls'",
                        "rm f", "touch f", "/bin/rm f", "FOO=1 rm f", "env rm f",
                        "timeout 5 rm f", "(rm f)", "{ rm f; }",
                        "for f in a; do rm $f; done", "echo $(rm f)", "echo `rm f`",
                        "jj new", "jj -R . squash", "jj --no-pager op log",
                        "jj workspace add x", "deccy record x", "git -C . commit -m x",
                        "cd x && jj describe -m y"):
            with self.subTest(command=command):
                self.assertBlocked(self.as_role(self.R, "Bash", command=command))


class OrchestratorShell(Base):
    R = "deccy-orchestrator"

    def test_protocol_commands_allowed(self):
        for command in ("deccy new --on abc -m 'x'", "deccy record nodes/x.json",
                        "deccy new --on abc --evaluates def -m 'gate x'",
                        "deccy draft abc --edit def", "deccy drafts",
                        "deccy discard h1 h2", "deccy record --from h1 --to abc",
                        "jj new abc", "jj workspace forget n",
                        "cd /w && jj workspace update-stale",
                        "jj restore --from abc --to @ -- src/a.py",
                        "printf '%s\\n' a b | xargs -r jj restore --from abc --to @ --",
                        '[ -n "$PATHS" ] && jj restore --from "$D" --to @ -- $PATHS',
                        '[ -n "$PATHS" ] && deccy record --from "$H" --to "$TARGET"',
                        "jj describe -m 'summary' abc",
                        "jj rebase -r abc -A def",
                        "~/.claude/skills/deccy-round/scripts/abandon-empty-heads.sh --dry-run",
                        "/x/deccy-round/scripts/delete-round-state.sh r1",
                        "$DECCY_SKILLS/deccy-round/scripts/abandon-empty-heads.sh --dry-run",
                        "printf '%s\\t%s\\n' U2 \"$id\" >> \"$MAP\"",
                        "deccy log", "deccy show abc", "deccy validate"):
            with self.subTest(command=command):
                self.assertAllowed(self.as_role(self.R, "Bash", command=command))

    def test_surgery_blocked(self):
        for command in ("jj new -A abc", "jj squash",
                        "jj describe abc", "jj abandon abc", "jj op restore x",
                        "jj restore src/a.py", "jj undo", "deccy remove x", "deccy init",
                        "git push", "rm -rf x", "mv a b",
                        "jj rebase -s abc -B def", "jj rebase --source abc -B def", "jj rebase -b abc -o def",
                        "jj workspace add /w --name n -r abc",
                        "sh -c 'jj squash'", "xargs jj abandon"):
            with self.subTest(command=command):
                self.assertBlocked(self.as_role(self.R, "Bash", command=command))


class DrafterShell(Base):
    R = "deccy-drafter"

    def test_shell(self):
        for command in ("cd /w && pytest -q", "jj diff --summary -r @", "jj st",
                        "rm build/x", "jj workspace update-stale",
                        "cd /w && jj workspace update-stale",
                        "jj restore --from a --to @ -- x",
                        "jj restore --from g --into @ -- y", "jj workspace list", "jj log"):
            with self.subTest(command=command):
                self.assertAllowed(self.as_role(self.R, "Bash", command=command))
        for command in ("jj new", "jj rebase -s a -B b", "jj restore src/a.py",
                        "deccy record x", "git commit -m x",
                        "jj rebase -s abc -B def", "jj rebase --source abc -B def", "jj rebase -b abc -o def",
                        "jj workspace add /w --name n -r abc", "jj workspace forget n"):
            with self.subTest(command=command):
                self.assertBlocked(self.as_role(self.R, "Bash", command=command))


class GateAuthorShell(Base):
    R = "deccy-gate-author"

    def test_shell(self):
        for command in ("cd /w && pytest -q", "jj st", "jj workspace update-stale"):
            with self.subTest(command=command):
                self.assertAllowed(self.as_role(self.R, "Bash", command=command))
        for command in ("jj new", "jj rebase -s a -B b",
                        "jj restore --from a --to @ -- x", "jj restore src/a.py",
                        "deccy record x", "git commit -m x", "jj workspace add /w"):
            with self.subTest(command=command):
                self.assertBlocked(self.as_role(self.R, "Bash", command=command))


class JudgeShell(Base):
    R = "deccy-judge"

    def test_clean_room(self):
        for command in ("deccy draft abc --edit def", "deccy drafts",
                        "deccy discard h1 h2", "cd /j/base && jj workspace update-stale",
                        "printf '%s\\n' t.py | xargs -r jj restore --from g --to @ --",
                        '[ -n "$GATE_PATHS" ] && jj restore --from g --to @ -- $GATE_PATHS',
                        'jj restore --from d --to @ -- $GATE_PATHS $DRAFT_PATHS',
                        "jj restore --from d --to @ -- src/a.py", "pytest -q > /dev/null",
                        "pytest -q 2>/dev/null", "jj diff --summary"):
            with self.subTest(command=command):
                self.assertAllowed(self.as_role(self.R, "Bash", command=command))
        for command in ("jj restore src/a.py", "jj new", "jj rebase -s a -B b",
                        "deccy record x", "jj describe -m x",
                        "jj workspace add /j/base -r abc && jj squash"):
            with self.subTest(command=command):
                self.assertBlocked(self.as_role(self.R, "Bash", command=command))


class ShellParser(Base):
    def test_unparseable_is_blocked(self):
        for command in ('echo "unterminated', "echo 'x"):
            with self.subTest(command=command):
                self.assertBlocked(self.as_role("deccy-plan", "Bash", command=command))

    def test_global_options_are_stripped(self):
        for command in ("jj -R . squash", "jj --repository . new",
                        "git -C . reset --hard", "git --git-dir ./.git commit -m x"):
            with self.subTest(command=command):
                self.assertBlocked(self.as_role("deccy-drafter", "Bash", command=command))

    def test_shell_bodies_and_substitutions_are_checked(self):
        for command in ("sh -c 'deccy record x'", "bash -c 'jj squash'",
                        "zsh -c 'jj squash'", "echo $(deccy record x)",
                        "echo `jj squash`", "true && (jj squash)"):
            with self.subTest(command=command):
                self.assertBlocked(self.as_role("deccy-drafter", "Bash", command=command))

    def test_dev_null_redirects_are_allowed(self):
        for command in ("deccy validate 2>/dev/null", "jj st >/dev/null",
                        "pytest -q > /dev/null 2>&1"):
            with self.subTest(command=command):
                self.assertAllowed(self.as_role("deccy-judge", "Bash", command=command))

    def test_wrappers_are_stripped(self):
        for command in ("env jj squash", "command jj squash", "nohup jj squash",
                        "time jj squash", "nice jj squash", "timeout 5 jj squash",
                        "builtin jj squash", "exec jj squash"):
            with self.subTest(command=command):
                self.assertBlocked(self.as_role("deccy-drafter", "Bash", command=command))

    def test_xargs_and_bare_commands(self):
        for command in ("xargs jj abandon", "xargs -0 jj squash", "jj op", "jj restore"):
            with self.subTest(command=command):
                self.assertBlocked(self.as_role("deccy-drafter", "Bash", command=command))

    def test_redirection_is_checked(self):
        for command in ("echo x > f", "echo x >> f", "echo x >| f", "echo x &> f",
                        "cat a>b", "echo x | tee f", "echo x | tee -a f"):
            with self.subTest(command=command):
                self.assertBlocked(self.as_role("deccy-plan", "Bash", command=command))

    def test_register_after_binding_is_denied(self):
        self.assertAllowed(self.spawn("deccy_drafter_u1"))
        self.assertAllowed(self.register("deccy_drafter_u1"))
        reason = self.child("Bash", command='"$DECCY_BIN" register deccy_drafter_u1')
        self.assertBlocked(reason)
        self.assertIn("already registered", reason)

    def test_launcher_is_denied_for_every_role(self):
        for role in ("deccy-plan", "deccy-orchestrator", "deccy-gate-author",
                     "deccy-drafter", "deccy-judge"):
            for command in ("deccy-codex plan", "deccy-codex orchestrator",
                            "$DECCY_BIN orchestrator", "${DECCY_BIN} plan",
                            "/opt/bundle/codex/deccy-codex orchestrator"):
                with self.subTest(role=role, command=command):
                    self.assertBlocked(self.as_role(role, "Bash", command=command))


class Skills(Base):
    def test_role_skill_allow_lists(self):
        allowed = {
            "deccy-plan": {"deccy-core", "deccy-round"},
            "deccy-orchestrator": {"deccy-core", "deccy-round"},
            "deccy-gate-author": {"deccy-core", "deccy-gate"},
            "deccy-drafter": {"deccy-core", "deccy-author"},
            "deccy-judge": {"deccy-core", "deccy-judge"},
        }
        every = {"deccy-core", "deccy-round", "deccy-gate", "deccy-author",
                 "deccy-judge", "other"}
        for role, skills in allowed.items():
            for skill in skills:
                with self.subTest(role=role, skill=skill, effect="allow"):
                    self.assertAllowed(self.as_role(role, "Skill", skill=skill))
            for skill in every - skills:
                with self.subTest(role=role, skill=skill, effect="block"):
                    self.assertBlocked(self.as_role(role, "Skill", skill=skill))

    def test_namespaced_skill(self):
        self.assertAllowed(self.as_role("deccy-drafter", "Skill", skill="deccy:deccy-author"))


if __name__ == "__main__":
    unittest.main()
