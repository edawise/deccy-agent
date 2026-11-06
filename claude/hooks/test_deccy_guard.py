"""Tests for deccy-guard.py: python3 -m unittest discover -s claude/hooks"""

import importlib.util
import os
import pathlib
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("deccy_guard", HERE / "deccy-guard.py")
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.realpath(self.tmp.name)
        os.environ["DECCY_GUARD_ROOT"] = self.root

    def tearDown(self):
        os.environ.pop("DECCY_GUARD_ROOT", None)
        self.tmp.cleanup()

    def run_tool(self, role, tool, main_role=None, **tool_input):
        event = {"tool_name": tool, "tool_input": tool_input, "cwd": self.root}
        if role:
            event["agent_type"] = role
        return guard.decide(event, main_role)

    def bash(self, role, cmd, main_role=None):
        return self.run_tool(role, "Bash", main_role, command=cmd)

    def assertAllowed(self, reason):
        self.assertIsNone(reason)

    def assertBlocked(self, reason):
        self.assertIsNotNone(reason)


class RoleResolution(Base):
    def test_no_deccy_session_is_untouched(self):
        self.assertAllowed(self.bash(None, "rm -rf x"))
        self.assertAllowed(self.bash("general-purpose", "rm -rf x"))

    def test_main_role_from_run_sh(self):
        self.assertBlocked(self.bash(None, "rm x", main_role="deccy-plan"))
        self.assertAllowed(self.bash(None, "jj log", main_role="deccy-plan"))

    def test_agent_type_wins_over_main_role(self):
        # a drafter spawned from an orchestrator session uses the drafter rules
        self.assertBlocked(self.bash("deccy-drafter", "deccy new x", main_role="deccy-orchestrator"))
        self.assertAllowed(self.bash(None, "deccy new x", main_role="deccy-orchestrator"))

    def test_foreign_agent_in_deccy_session_reads_only(self):
        self.assertBlocked(self.bash("general-purpose", "ls", main_role="deccy-orchestrator"))
        self.assertAllowed(self.run_tool("Explore", "Read", "deccy-orchestrator", file_path="/x"))


class Plan(Base):
    R = "deccy-plan"

    def test_reads_allowed(self):
        for c in ("deccy log", "deccy show abc", "deccy validate", "jj log -r 'heads(all())'",
                  "jj workspace list", "jj st", "deccy show x 2>&1 | head -50",
                  "deccy validate 2>/dev/null", "cat nodes/a.json"):
            self.assertAllowed(self.bash(self.R, c))

    def test_writes_and_wrappers_blocked(self):
        for c in ("echo x > f", "echo x >> f", "cat a>b", "tee f", "ls | tee f", "sed -i s/a/b/ f",
                  "python3 -c 'open(1)'", "bash -c 'ls'", "rm f", "touch f", "/bin/rm f",
                  "FOO=1 rm f", "env rm f", "timeout 5 rm f", "(rm f)", "{ rm f; }",
                  "for f in a; do rm $f; done", "echo $(rm f)", "echo `rm f`",
                  "jj new", "jj -R . squash", "jj --no-pager op log", "jj workspace add x",
                  "deccy record x", "git -C . commit -m x", "cd x && jj describe -m y"):
            self.assertBlocked(self.bash(self.R, c))

    def test_plan_dir_only(self):
        self.assertAllowed(self.run_tool(self.R, "Write", file_path=f"{self.root}/plan/r1.plan.md"))
        self.assertBlocked(self.run_tool(self.R, "Write", file_path=f"{self.root}/plan/a/b.md"))
        self.assertBlocked(self.run_tool(self.R, "Edit", file_path=f"{self.root}/rounds/r/ROUND.md"))
        self.assertBlocked(self.run_tool(self.R, "Write", file_path="nodes/x.json"))
        self.assertBlocked(self.run_tool(self.R, "Write", file_path=f"{self.root}/plan/../x"))

    def test_no_agents(self):
        self.assertBlocked(self.run_tool(self.R, "Agent", subagent_type="deccy-drafter"))


class Orchestrator(Base):
    R = "deccy-orchestrator"

    def test_protocol_commands_allowed(self):
        for c in ("deccy new --on abc -m 'x'", "deccy record nodes/x.json",
                  "jj new abc", "jj workspace add /w --name n -r abc", "jj workspace forget n",
                  "cd /w && jj workspace update-stale",
                  "jj restore --from abc --to @ -- src/a.py",
                  "printf '%s\\n' a b | xargs -r jj restore --from abc --to @ --",
                  "jj describe -m 'summary' abc",
                  "~/.claude/skills/deccy-round/scripts/abandon-empty-heads.sh --dry-run",
                  "/x/deccy-round/scripts/delete-round-state.sh r1",
                  "printf '%s\\t%s\\n' U2 \"$id\" >> \"$MAP\""):
            self.assertAllowed(self.bash(self.R, c))

    def test_surgery_blocked(self):
        for c in ("jj new -A abc", "jj squash", "jj rebase -r a -B b", "jj describe abc",
                  "jj abandon abc", "jj op restore x", "jj restore src/a.py", "jj undo",
                  "deccy remove x", "deccy init", "git push", "rm -rf x", "mv a b",
                  "sh -c 'jj squash'", "xargs jj abandon"):
            self.assertBlocked(self.bash(self.R, c))

    def test_writes(self):
        self.assertAllowed(self.run_tool(self.R, "Write", file_path=f"{self.root}/rounds/r1/ROUND.md"))
        self.assertAllowed(self.run_tool(self.R, "Write", file_path=f"{self.root}/plan/r1.plan.md"))
        self.assertBlocked(self.run_tool(self.R, "Edit", file_path=f"{self.root}/workspaces/drafts/x"))
        self.assertBlocked(self.run_tool(self.R, "Edit", file_path="nodes/abc.json"))

    def test_agents(self):
        for s in ("deccy-plan", "deccy-gate-author", "deccy-drafter", "deccy-judge"):
            self.assertAllowed(self.run_tool(self.R, "Agent", subagent_type=s))
            self.assertAllowed(self.run_tool(self.R, "Task", subagent_type=s))
        self.assertBlocked(self.run_tool(self.R, "Agent", subagent_type="general-purpose"))
        self.assertBlocked(self.run_tool(self.R, "Agent"))

    def test_skills(self):
        self.assertAllowed(self.run_tool(self.R, "Skill", skill="deccy-round"))
        self.assertBlocked(self.run_tool(self.R, "Skill", skill="deccy-author"))


class Drafter(Base):
    R = "deccy-drafter"

    def test_workspace_only(self):
        self.assertAllowed(self.run_tool(self.R, "Edit",
                                         file_path=f"{self.root}/workspaces/drafts/r/c/u/src/a.py"))
        self.assertBlocked(self.run_tool(self.R, "Edit",
                                         file_path=f"{self.root}/workspaces/judge/r/c/u/src/a.py"))
        self.assertBlocked(self.run_tool(self.R, "Write", file_path="/etc/x"))

    def test_shell(self):
        for c in ("cd /w && pytest -q", "jj diff --summary -r @", "jj st", "rm build/x"):
            self.assertAllowed(self.bash(self.R, c))
        for c in ("jj new", "jj restore --from a --to @ -- x", "deccy record x",
                  "jj workspace update-stale", "git commit -m x"):
            self.assertBlocked(self.bash(self.R, c))


class GateAuthor(Drafter):
    R = "deccy-gate-author"


class Judge(Base):
    R = "deccy-judge"

    def test_clean_room(self):
        for c in ("jj workspace add /j/base --name n -r abc", "jj workspace forget n",
                  "cd /j/base && jj workspace update-stale",
                  "printf '%s\\n' t.py | xargs -r jj restore --from g --to @ --",
                  "jj restore --from d --to @ -- src/a.py", "pytest -q > /dev/null"):
            self.assertAllowed(self.bash(self.R, c))
        for c in ("jj restore src/a.py", "jj new", "deccy record x", "jj describe -m x"):
            self.assertBlocked(self.bash(self.R, c))

    def test_judge_workspace_only(self):
        self.assertAllowed(self.run_tool(self.R, "Write",
                                         file_path=f"{self.root}/workspaces/judge/r/c/u/cand/m.py"))
        self.assertBlocked(self.run_tool(self.R, "Write",
                                         file_path=f"{self.root}/workspaces/drafts/r/c/u/a.py"))


if __name__ == "__main__":
    unittest.main()
