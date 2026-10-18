// deccy-edit tests — full pipeline with stubbed sessions and a fake
// deccy/jj/python runner: zero model calls. Covers the happy path, the
// enforced edit-report seam (corrective retry + refusal), validation rework
// rounds, and named preconditions.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StageSession } from "../lib/stageJson.ts";
import type { DeccyRunner, RunResult } from "../lib/deccyCli.ts";
import { fixtureDir, fixtureGraph } from "../lib/fixtures/graph/fixtureGraph.ts";
import { deccyEdit, parseCli, runEditInteractive } from "./index.ts";
import { buildEditPrompt, buildReadOnlyPrompt, extractEditReport } from "./stages/edit.ts";

class FakeRunner implements DeccyRunner {
  root: string;
  calls: { tool: string; argv: string[] }[] = [];
  validateOutput = "";
  checkOutput: Record<string, string> = {};

  constructor(root: string) {
    this.root = root;
  }

  deccy = async (argv: string[]): Promise<RunResult> => {
    this.calls.push({ tool: "deccy", argv: [...argv] });
    if (argv[0] === "validate") return { code: 0, stdout: this.validateOutput, stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };

  jj = async (argv: string[]): Promise<RunResult> => {
    this.calls.push({ tool: "jj", argv: [...argv] });
    if (argv[0] === "log") return { code: 0, stdout: "nn000009\n", stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };

  python = async (scriptPath: string, args: string[] = []): Promise<RunResult> => {
    this.calls.push({ tool: "python", argv: [scriptPath, ...args] });
    const name = path.basename(scriptPath ?? "");
    const out = this.checkOutput[name] ?? "clean\n";
    return { code: out.includes("problem") ? 1 : 0, stdout: out, stderr: "" };
  };
}

function setup(): { root: string; runner: FakeRunner } {
  const root = mkdtempSync(path.join(os.tmpdir(), "deccy-edit-test-"));
  cpSync(path.join(fixtureDir(), "nodes"), path.join(root, "nodes"), { recursive: true });
  return { root, runner: new FakeRunner(root) };
}

const editReply = (created: string[] = [], edited: string[] = []) =>
  "```json\n" +
  JSON.stringify({
    kind: "edit-report",
    created: created.map((id) => ({ id, summary: "added", on: ["adocsw01"], files: ["src/x.ts"] })),
    edited: edited.map((id) => ({ id, files: ["src/y.ts"] })),
    deviations: [],
  }) +
  "\n```";

const stub = (replies: string[]) => {
  let i = 0;
  return (): Promise<StageSession> =>
    Promise.resolve({ prompt: async () => replies[Math.min(i++, replies.length - 1)] });
};

/** Stub that also emits a thinking block on every prompt (like the SDK does). */
const thinkingStub = (reply: string) => {
  const emit = (type: string, delta?: string) =>
    listener?.({ type: "message_update", assistantMessageEvent: { type, ...(delta !== undefined ? { delta } : {}) } });
  let listener: ((e: any) => void) | null = null;
  const session: StageSession = {
    prompt: async () => {
      emit("thinking_start");
      emit("thinking_delta", "pondering the nodes");
      emit("thinking_end");
      return reply;
    },
    subscribe: (l) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
  };
  return (): Promise<StageSession> => Promise.resolve(session);
};

test("happy path: one directive → edit-report payload, validators run", async () => {
  const { root, runner } = setup();
  const payload = await deccyEdit({
    request: "add a node for the export button",
    graphDir: root,
    sessionOverrides: { "deccy-edit": stub([editReply(["nn000001"], ["bfts5x03"])]) },
    runner,
  });
  assert.equal(payload.failed, false, payload.reason);
  assert.equal(payload.created?.length, 1);
  assert.equal(payload.created?.[0].id, "nn000001");
  assert.equal(payload.edited?.length, 1);
  assert.deepEqual(payload.validation, []);
  assert.ok(runner.calls.some((c) => c.tool === "deccy" && c.argv[0] === "validate"));
  assert.ok(runner.calls.some((c) => c.tool === "python"));
});

test("enforced output: an unusable report earns one corrective retry", async () => {
  const { root, runner } = setup();
  const payload = await deccyEdit({
    request: "fix the search summary",
    graphDir: root,
    sessionOverrides: { "deccy-edit": stub(["here are my edits, no report", editReply([], ["bfts5x03"])]) },
    runner,
  });
  assert.equal(payload.failed, false, payload.reason);
  assert.equal(payload.edited?.length, 1);
});

test("enforced output: a report that never parses is a named failure", async () => {
  const { root, runner } = setup();
  const payload = await deccyEdit({
    request: "fix the search summary",
    graphDir: root,
    sessionOverrides: { "deccy-edit": stub(["nope", "still nope"]) },
    runner,
  });
  assert.equal(payload.failed, true);
  assert.match(payload.reason ?? "", /edit report unusable/);
});

test("validation failures earn bounded rework rounds, then a named failure", async () => {
  const { root, runner } = setup();
  runner.validateOutput = "coverage nn000001 bfts5x03\n";
  const payload = await deccyEdit({
    request: "add a node",
    graphDir: root,
    sessionOverrides: {
      "deccy-edit": stub([editReply(["nn000001"]), editReply(["nn000001"]), editReply(["nn000001"])]),
    },
    runner,
  });
  assert.equal(payload.failed, true);
  assert.match(payload.reason ?? "", /validation still failing/);
  assert.match(payload.reason ?? "", /deccy validate: coverage nn000001/);
  // Reports merge by node id across rework rounds — no double counting.
  assert.equal(payload.created?.length, 1);
  assert.equal(payload.created?.[0].files.length, 1);
});

test("precondition: a graph with problems is refused by name", async () => {
  const { root, runner } = setup();
  writeFileSync(
    path.join(root, "nodes", "zzzzzz99.json"),
    JSON.stringify({ kind: "weird", content: { type: "t", ref: ["a"], rationale: "r" }, depends_on: ["adocsw01"] }),
    "utf8",
  );
  const payload = await deccyEdit({
    request: "anything",
    graphDir: root,
    sessionOverrides: { "deccy-edit": stub([]) },
    runner,
  });
  assert.equal(payload.failed, true);
  assert.match(payload.reason ?? "", /graph has problems/);
  assert.match(payload.reason ?? "", /kind must be/);
});

test("precondition: no request is a named failure", async () => {
  const { root, runner } = setup();
  const payload = await deccyEdit({ graphDir: root, sessionOverrides: { "deccy-edit": stub([]) }, runner });
  assert.equal(payload.failed, true);
  assert.match(payload.reason ?? "", /no request given/);
});

test("extractEditReport enforces ids and collects deviations", () => {
  const bad = extractEditReport('```json\n{"kind":"edit-report","created":[{"files":["a"]}]}\n```');
  assert.equal(bad.ok, false);
  const good = extractEditReport(editReply(["nn000001"]));
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.report.created[0].id, "nn000001");
    assert.deepEqual(good.report.created[0].on, ["adocsw01"]);
    assert.deepEqual(good.report.edited, []);
    assert.deepEqual(good.report.deviations, []);
    assert.equal(good.report.summary, undefined);
  }
  const withSummary = extractEditReport(
    '```json\n{"kind":"edit-report","summary":"Condensed 3 docs.","created":[],"edited":[],"deviations":[]}\n```',
  );
  assert.equal(withSummary.ok, true);
  if (withSummary.ok) assert.equal(withSummary.report.summary, "Condensed 3 docs.");
});

test("interactive REPL: seeded first turn, /check, accumulated payload", async () => {
  const { root, runner } = setup();
  const chunks: string[] = [];
  const outputStream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  const payload = await runEditInteractive({
    request: "add a node for the export button",
    graphDir: root,
    interactiveStreams: {
      inputStream: Readable.from(["fix the search summary\n", "/check\n", "/exit\n"]),
      outputStream,
    },
    sessionOverrides: { "deccy-edit": stub([editReply(["nn000001"]), editReply([], ["bfts5x03"])]) },
    runner,
  });
  assert.equal(payload.failed, false, payload.reason);
  assert.equal(payload.created?.length, 1); // seeded turn only — the REPL turn edited
  assert.equal(payload.edited?.length, 1);
  const out = chunks.join("");
  assert.match(out, /Validation: clean/);
  assert.match(out, /\[deccy-edit\] interactive edit session/);
});

test("parseCli: positional request + simple flags (no --revise/--prompt)", () => {
  const args = parseCli(["add", "a", "node", "--graph", "/tmp/g", "-i", "--model", "p/m"]);
  assert.equal(args.request, "add a node");
  assert.equal(args.graphDir, "/tmp/g");
  assert.equal(args.interactive, true);
  assert.equal(args.model, "p/m");
  assert.equal("revise" in args, false);
  assert.equal("prompt" in args, false);
});

test("interactive /ask and /plan are read-only turns with narrowed tools", async () => {
  const { root, runner } = setup();
  const chunks: string[] = [];
  const outputStream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  const prompts: string[] = [];
  const toolCalls: string[][] = [];
  const sessionFactory = (): Promise<StageSession> =>
    Promise.resolve({
      prompt: async (p: string) => {
        prompts.push(p);
        if (p.includes("READ-ONLY question turn")) return "The nodes cover search, toolbar and documents.";
        if (p.includes("READ-ONLY planning turn")) return "- bfts5x03: condense content — `deccy record nodes/bfts5x03.json --to bfts5x03`";
        return editReply([], ["bfts5x03"]);
      },
      setTools: (names: string[]) => {
        toolCalls.push([...names]);
      },
    });
  const payload = await runEditInteractive({
    graphDir: root,
    interactiveStreams: {
      inputStream: Readable.from([
        "/ask what do the nodes cover?\n",
        "/plan condense the verbose nodes\n",
        "/exit\n",
      ]),
      outputStream,
    },
    sessionOverrides: { "deccy-edit": sessionFactory },
    runner,
  });
  assert.equal(payload.failed, false, payload.reason);
  assert.equal(payload.edited?.length, 0); // no edit turn ran
  const out = chunks.join("");
  assert.match(out, /The nodes cover search, toolbar and documents/);
  assert.match(out, /bfts5x03: condense content/);
  // tools narrowed for each read-only turn, restored after
  assert.deepEqual(toolCalls, [
    ["read"],
    ["read", "bash", "edit", "write"],
    ["read"],
    ["read", "bash", "edit", "write"],
  ]);
  assert.ok(prompts.some((p) => p.includes("READ-ONLY planning turn")));
});

test("edit turns print the report summary; bare 'apply' expands to the plan directive", async () => {
  const { root, runner } = setup();
  const chunks: string[] = [];
  const outputStream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  const prompts: string[] = [];
  const summaryReply =
    "```json\n" +
    JSON.stringify({
      kind: "edit-report",
      summary: "Condensed the rationale on bfts5x03 and csrchb04 to one sentence each.",
      created: [],
      edited: [{ id: "bfts5x03", files: ["nodes/bfts5x03.json"] }],
      deviations: [],
    }) +
    "\n```";
  const payload = await runEditInteractive({
    graphDir: root,
    interactiveStreams: {
      inputStream: Readable.from(["apply\n", "/exit\n"]),
      outputStream,
    },
    sessionOverrides: {
      "deccy-edit": (): Promise<StageSession> =>
        Promise.resolve({
          prompt: async (p: string) => {
            prompts.push(p);
            return summaryReply;
          },
        }),
    },
    runner,
  });
  assert.equal(payload.failed, false, payload.reason);
  assert.match(prompts[0], /Apply the plan you proposed in your previous message/);
  assert.match(chunks.join(""), /Condensed the rationale on bfts5x03 and csrchb04/);
  assert.match(payload.summary ?? "", /Condensed the rationale/);
});

test("parseCli: --no-thinking turns the thinking stream off (default on)", () => {
  assert.equal(parseCli(["fix it"]).thinking, undefined); // default: print thinking
  assert.equal(parseCli(["fix it", "--no-thinking"]).thinking, false);
});

test("one-shot streams thinking to stderr by default, --no-thinking silences it", async () => {
  const { root, runner } = setup();
  const chunks: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  (process.stderr as any).write = (c: any) => {
    chunks.push(String(c));
    return true;
  };
  try {
    await deccyEdit({
      request: "fix it",
      graphDir: root,
      sessionOverrides: { "deccy-edit": thinkingStub(editReply([], ["bfts5x03"])) },
      runner,
    });
    assert.match(chunks.join(""), /\[thinking\]\npondering the nodes/);
    chunks.length = 0;
    await deccyEdit({
      request: "fix it",
      graphDir: root,
      thinking: false,
      sessionOverrides: { "deccy-edit": thinkingStub(editReply([], ["bfts5x03"])) },
      runner,
    });
    assert.doesNotMatch(chunks.join(""), /pondering the nodes/);
  } finally {
    (process.stderr as any).write = orig;
  }
});

test("edit prompt carries the absolute toolkit paths (target repo has no scripts/)", () => {
  const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "skills", "deccy-agent");
  const prompt = buildEditPrompt({
    request: "condense node content",
    graph: fixtureGraph(),
    skillDir,
    rolesDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "roles"),
    graphRoot: "/tmp/tb1",
  });
  assert.match(prompt, /check-topology\.py \/tmp\/tb1/);
  assert.match(prompt, /check-ref-custody\.py \/tmp\/tb1/);
  assert.match(prompt, /record nodes\/<id>\.json --to <id>/);
  // exactly one toolkit section, and it leads the prompt — before the skill
  // body's script mentions and before the graph digest (the regression that
  // made agents look for scripts/ in the target repo).
  const first = prompt.indexOf("## Validation toolkit");
  assert.ok(first >= 0, "toolkit section missing");
  assert.equal(prompt.indexOf("## Validation toolkit", first + 1), -1, "more than one toolkit section");
  assert.ok(first < prompt.indexOf("# Deccy graph work"), "toolkit must precede the skill body");
  assert.ok(first < prompt.indexOf("Graph digest (compiled from"), "toolkit must precede the graph digest");
});

test("read-only prompts carry the toolkit guidance (no missing-scripts deviations)", () => {
  const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "skills", "deccy-agent");
  for (const mode of ["ask", "plan"] as const) {
    const prompt = buildReadOnlyPrompt({
      mode,
      request: "summarize the nodes",
      graph: fixtureGraph(),
      skillDir,
    });
    assert.match(prompt, /check-topology\.py/);
    assert.match(prompt, /never report them missing/);
    assert.ok(
      prompt.indexOf("Validation toolkit") < prompt.indexOf("Graph digest (compiled from"),
      "toolkit guidance must precede the graph digest",
    );
  }
});
