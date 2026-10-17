// hostValidators tests — the 0-LLM validator trio and the absolute toolkit
// section agents get in prompts (so a target repo never needs its own copy of
// the checker scripts).

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import type { DeccyRunner, RunResult } from "./deccyCli.ts";
import { checkerScriptPath, runHostValidators, toolkitSection } from "./hostValidators.ts";

const fakeRunner = (opts: {
  validate?: string;
  checks?: Record<string, string>;
}): DeccyRunner => {
  const run = async (): Promise<RunResult> => ({ code: 0, stdout: "", stderr: "" });
  return {
    root: "/tmp/some-graph-repo",
    deccy: async (argv) =>
      argv[0] === "validate"
        ? { code: 0, stdout: opts.validate ?? "", stderr: "" }
        : { code: 0, stdout: "", stderr: "" },
    jj: run,
    python: async (scriptPath: string) => {
      const name = path.basename(scriptPath);
      const out = opts.checks?.[name] ?? "clean\n";
      return { code: out.includes("problem") ? 1 : 0, stdout: out, stderr: "" };
    },
  };
};

test("checkerScriptPath resolves from the bundle, absolute", () => {
  const p = checkerScriptPath("check-topology.py");
  assert.ok(path.isAbsolute(p));
  assert.match(p, /skills[/\\]deccy-agent[/\\]scripts[/\\]check-topology\.py$/);
});

test("toolkitSection hands agents the absolute script paths + graph root", () => {
  const s = toolkitSection("/tmp/tb1");
  assert.match(s, new RegExp(checkerScriptPath("check-topology.py").replace(/[\\/]/g, "[\\\\/]")));
  assert.match(s, new RegExp(checkerScriptPath("check-ref-custody.py").replace(/[\\/]/g, "[\\\\/]")));
  assert.match(s, /\/tmp\/tb1/);
  assert.match(s, /target repo has no scripts\//);
});

test("runHostValidators aggregates all three checkers by line", async () => {
  const v = await runHostValidators(
    fakeRunner({
      validate: "coverage abc12345 def67890\n",
      checks: {
        "check-topology.py": "1 problem(s):\n  abc12345 -> def67890: prerequisite is newer\n",
        "check-ref-custody.py": "clean\n",
      },
    }),
  );
  assert.equal(v.ok, false);
  assert.ok(v.lines.some((l) => l === "deccy validate: coverage abc12345 def67890"));
  assert.ok(v.lines.some((l) => /check-topology\.py: abc12345 -> def67890/.test(l)));
  assert.equal(v.lines.filter((l) => /check-ref-custody/.test(l)).length, 0);
});

test("runHostValidators is clean when nothing reports", async () => {
  const v = await runHostValidators(fakeRunner({}));
  assert.equal(v.ok, true);
  assert.deepEqual(v.lines, []);
});
