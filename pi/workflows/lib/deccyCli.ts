// deccyCli — the only place that knows how to drive `deccy`, `jj` and the
// read-only checker scripts. Safe argv (never a shell string), injectable for
// tests via the DeccyRunner interface.
//
// Verified contract against the real Rust `deccy` binary (2026-02 probe):
//   deccy new -m <summary> --on <id>...   → prints the new change id on stdout,
//       inserts the new change immediately after the newest id of the --on set
//       (descendants are rebased above it), writes a decision skeleton to
//       nodes/<id>.json. Requires .deccy/ (created by `deccy init`).
//   deccy record <path>... --to <id>      → silent on success (exit 0); refuses
//       unowned/unknown paths with a named message and a non-zero exit.
//   deccy log                             → one "<id> <kind> <summary>" line per
//       node, read from the WORKING COPY (node files above @ are invisible —
//       settle @ at the stack top first, see settleWorkingCopy).
//   deccy show <id>                       → the node document as pretty JSON.
//   deccy validate                        → prints one "<check> <id> <reason>"
//       line per failure and EXITS 0 EVEN WHEN DIRTY — judge by output.
//   jj describe -m "<summary>" <id>       → the one raw-jj exception (retitle).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { compileGraph, loadNodeDocs, ROOT_ID, type CompiledGraph } from "./graphReader.ts";

const execFileAsync = promisify(execFile);

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface DeccyRunner {
  root: string;
  deccy(args: string[]): Promise<RunResult>;
  jj(args: string[]): Promise<RunResult>;
  /** Run a read-only checker script (python3) from the deccy-agent skill. */
  python(scriptPath: string, args: string[]): Promise<RunResult>;
}

export function createProcessRunner(root: string): DeccyRunner {
  const run = async (cmd: string, args: string[]): Promise<RunResult> => {
    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
      return { code: 0, stdout, stderr };
    } catch (err: any) {
      const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      return {
        code: typeof e.code === "number" ? e.code : 1,
        stdout: e.stdout ?? "",
        stderr: e.stderr || e.message || "",
      };
    }
  };
  return {
    root,
    deccy: (args) => run("deccy", args),
    jj: (args) => run("jj", args),
    python: (scriptPath, args) => run("python3", [scriptPath, ...args]),
  };
}

const CHANGE_ID = /^[0-9a-z]{8,}$/;

export interface NewNodeArgs {
  summary: string;
  /** Prerequisite change ids (root id allowed). One `--on` per id. */
  on: string[];
}

/** `deccy new -m <summary> --on <id> --on <id>` → the new change id. */
export async function newNode(runner: DeccyRunner, args: NewNodeArgs): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  if (args.on.length === 0) return { ok: false, reason: "deccy new needs at least one --on prerequisite" };
  const argv = ["new", "-m", args.summary, ...args.on.flatMap((id) => ["--on", id])];
  const res = await runner.deccy(argv);
  if (res.code !== 0) {
    return { ok: false, reason: `deccy ${argv.join(" ")} failed (exit ${res.code}): ${(res.stderr || res.stdout).trim()}` };
  }
  // Defensive parse: the first change-id-looking token on stdout is the id.
  const token = res.stdout.split(/\s+/).find((t) => CHANGE_ID.test(t));
  if (!token) {
    return { ok: false, reason: `deccy new succeeded but printed no change id (stdout: ${JSON.stringify(res.stdout.trim())})` };
  }
  return { ok: true, id: token.slice(0, 8) };
}

/** `deccy record <paths...> --to <id>` — moves working-copy edits into the node. */
export async function recordPaths(runner: DeccyRunner, paths: string[], to: string): Promise<RunResult> {
  return runner.deccy(["record", ...paths, "--to", to]);
}

/** `jj describe -m <summary> <id>` — the one raw-jj exception (change summary). */
export async function describeChange(runner: DeccyRunner, id: string, summary: string): Promise<RunResult> {
  return runner.jj(["describe", "-m", summary, id]);
}

export interface ValidateFailure {
  check: string;
  id: string;
  reason: string;
}

/** Parse `deccy validate` stdout. Empty output = clean (it exits 0 regardless). */
export function parseValidateOutput(stdout: string): ValidateFailure[] {
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [check, id, ...rest] = line.split(/\s+/);
      return { check, id, reason: rest.join(" ") };
    });
}

export async function validateGraph(runner: DeccyRunner): Promise<{ failures: ValidateFailure[]; raw: string }> {
  const res = await runner.deccy(["validate"]);
  const raw = `${res.stdout}${res.stderr ? `\n${res.stderr}` : ""}`.trim();
  return { failures: parseValidateOutput(res.stdout), raw };
}

/** `deccy log` → { id → summary } plus kind, read from the working copy. */
export async function readLog(runner: DeccyRunner): Promise<{ ok: true; summaries: Record<string, string> } | { ok: false; reason: string }> {
  const res = await runner.deccy(["log"]);
  if (res.code !== 0) return { ok: false, reason: `deccy log failed: ${(res.stderr || res.stdout).trim()}` };
  const summaries: Record<string, string> = {};
  for (const line of res.stdout.split("\n")) {
    const m = /^(\S+)\s+(decision|evaluation)\s+(.*)$/.exec(line.trim());
    if (m) summaries[m[1]] = m[3];
  }
  return { ok: true, summaries };
}

/** jj history order: full change ids, newest first. */
export async function historyOrder(runner: DeccyRunner): Promise<{ ok: true; newestFirst: string[] } | { ok: false; reason: string }> {
  const res = await runner.jj(["log", "-r", "all()", "--no-graph", "-T", 'change_id ++ "\\n"']);
  if (res.code !== 0) return { ok: false, reason: `jj log failed: ${(res.stderr || res.stdout).trim()}` };
  return { ok: true, newestFirst: res.stdout.split(/\s+/).filter(Boolean) };
}

/** The topmost change of the stack (short id), or null when unavailable. */
export async function topChange(runner: DeccyRunner): Promise<string | null> {
  const res = await runner.jj(["log", "-r", "heads(all())", "--no-graph", "-T", 'change_id.shortest(8) ++ "\\n"']);
  if (res.code !== 0) return null;
  return res.stdout.split(/\s+/).filter(Boolean)[0] ?? null;
}

/**
 * Settle the working copy at the stack top (`jj edit <top>`). `deccy new`
 * inserts mid-stack (insert-after), so after a placement run the node files of
 * changes above @ are invisible on disk; moving @ to the top makes the whole
 * graph visible for the content stage and validation. No content changes.
 */
export async function settleWorkingCopy(runner: DeccyRunner): Promise<RunResult | null> {
  const top = await topChange(runner);
  if (!top) return null;
  return runner.jj(["edit", top]);
}

export interface GraphFromRepo {
  graph: CompiledGraph;
  problems: string[];
  /** deccy/jj availability notes (skill §1: note deviations, don't impose). */
  notes: string[];
}

/** Compile the graph from a repo working copy: nodes/*.json + deccy log + jj order. */
export async function loadGraphFromRepo(runner: DeccyRunner): Promise<GraphFromRepo> {
  const nodesDir = path.join(runner.root, "nodes");
  const { entries, problems } = loadNodeDocs(nodesDir);
  const notes: string[] = [];

  const log = await readLog(runner);
  if (log.ok) {
    for (const e of entries) {
      const exact = log.summaries[e.id];
      if (exact) e.summary = exact;
      else {
        const match = Object.keys(log.summaries).find((k) => k.startsWith(e.id) || e.id.startsWith(k));
        if (match) e.summary = log.summaries[match];
      }
    }
  } else {
    notes.push(`deccy log unavailable (${log.reason}) — node summaries fall back to empty`);
  }

  const hist = await historyOrder(runner);
  if (hist.ok) {
    const pos = new Map<string, number>();
    hist.newestFirst.forEach((full, i) => pos.set(full, hist.newestFirst.length - i)); // larger = newer
    for (const e of entries) {
      const hit = [...pos.keys()].find((full) => full.startsWith(e.id) || e.id.startsWith(full));
      if (hit) e.pos = pos.get(hit);
    }
    if (entries.some((e) => e.pos === undefined)) {
      notes.push("jj history does not cover every node file — history-order checks (R8) may be skipped");
    }
  } else {
    notes.push(`jj history unavailable (${hist.reason}) — history-order checks (R8) are skipped`);
  }

  const { graph, problems: compileProblems } = compileGraph(entries);
  return { graph, problems: [...problems, ...compileProblems], notes };
}

export { ROOT_ID };
