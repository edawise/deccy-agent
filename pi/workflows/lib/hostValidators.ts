// hostValidators — the 0 LLM working-copy checks deccy-edit runs after every
// turn: `deccy validate` plus the two read-only checker scripts from the
// deccy-agent skill. `deccy validate` exits 0 even when dirty, so the verdict
// is line-based: any reported line is a problem.

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DeccyRunner, RunResult } from "./deccyCli.ts";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(moduleDir, "..", "..", "skills", "deccy-agent");

export interface HostValidation {
  ok: boolean;
  lines: string[];
}

/** The two read-only checker scripts shipped in the deccy-agent bundle. */
export const CHECKER_SCRIPTS = ["check-topology.py", "check-ref-custody.py"] as const;

/** Absolute path of a checker script in the BUNDLE (works from any cwd/
 *  target repo — the graph repo never carries its own copy). */
export function checkerScriptPath(script: (typeof CHECKER_SCRIPTS)[number]): string {
  return path.join(skillDir, "scripts", script);
}

/**
 * Prompt section giving agents the absolute toolkit paths. The prepended
 * SKILL.md body mentions `scripts/<name>` skill-relative; an agent working in
 * a target graph repo would look for them in the WRONG repo without this.
 */
export function toolkitSection(graphRoot: string): string {
  return [
    "## Validation toolkit (absolute paths — the target repo has no scripts/ directory)",
    "The skill body mentions `scripts/check-topology.py` and `scripts/check-ref-custody.py` skill-relative; they live in the deccy-agent bundle. Invoke the read-only checkers against the graph root like this:",
    `- python3 ${checkerScriptPath("check-topology.py")} ${graphRoot}`,
    `- python3 ${checkerScriptPath("check-ref-custody.py")} ${graphRoot}`,
    "- deccy validate   (run in the graph root: schema, edge resolution, I4 coverage)",
    "Exit 0 = clean; the scripts print \"N problem(s):\" lines otherwise. The controller runs these after your turn — run them yourself before finishing to self-check.",
    "",
  ].join("\n");
}

/** deccy validate + check-topology.py + check-ref-custody.py (skill scripts). */
export async function runHostValidators(runner: DeccyRunner): Promise<HostValidation> {
  const lines: string[] = [];

  const res: RunResult = await runner.deccy(["validate"]);
  const validateLines = (res.stdout || res.stderr)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of validateLines) lines.push(`deccy validate: ${line}`);
  if (res.code !== 0) lines.push(`deccy validate exited ${res.code}: ${(res.stderr || res.stdout).trim()}`);

  for (const script of CHECKER_SCRIPTS) {
    const scriptPath = checkerScriptPath(script);
    const out = await runner.python(scriptPath, [runner.root]);
    const body = (out.stdout + out.stderr).split("\n").map((l) => l.trim()).filter(Boolean);
    // Exit 0 is authoritative-clean; anything else is reported verbatim
    // (the scripts print "topology clean"/"custody clean" when healthy).
    if (out.code !== 0) {
      for (const line of body) {
        if (/^(\d+ problem\(s\):|no node directory|cannot read)/.test(line)) continue;
        lines.push(`${script}: ${line}`);
      }
      if (body.length === 0) lines.push(`${script}: exited ${out.code}`);
    }
  }

  return { ok: lines.length === 0, lines };
}
