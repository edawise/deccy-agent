#!/usr/bin/env node
// deccy-edit SDK workflow — direct edits and node adds on a deccy graph, with
// the same enforced-output seam as deccy-executor but WITHOUT a
// `.deccy_plan.md`: one agent call applies the directive straight to the
// working copy (`deccy new` / `deccy record` included), the controller parses
// the edit-report, runs the host validators, and prints the payload.
//
//   node workflows/deccy-edit/index.ts ["<request>"] [--graph <dir>]
//        [--interactive|-i] [--model provider/model[:thinking]]
//
// Flow:
//   1. Load + gate (host): compile the graph (nodes/*.json + deccy log + jj
//      history); graph problems refuse the run by name.
//   2. Edit (role deccy-edit, tools read/bash/edit/write, thinking high): the
//      role edits ref'd files, `deccy record`s them into their node, and may
//      `deccy new` small additions directly — concluding with the enforced
//      fenced ```json edit-report (one corrective follow-up when unusable).
//   3. Validation rounds (host): deccy validate + scripts/check-topology.py +
//      scripts/check-ref-custody.py; errors feed back as bounded rework
//      rounds (≤ 2) on the same session.
//   4. Payload JSON on stdout; exit 0 clean / 1 failed / 2 usage.
//
// -i is a REPL on the live session (the positional request, if any, runs as
// the first turn): /check /status /undo, everything else is an edit turn with
// the same enforced report. No --prompt / --revise: the request line (or the
// REPL) is the only input surface.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  resolveCliModel,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { StageSession, StageSessionFactory } from "../lib/stageJson.ts";
import { runInteractiveReworkLoop, streamThinking } from "../lib/interactiveRework.ts";
import { runHostValidators, type HostValidation } from "../lib/hostValidators.ts";
import {
  createProcessRunner,
  loadGraphFromRepo,
  type DeccyRunner,
} from "../lib/deccyCli.ts";
import { runEditStage, runReadOnlyTurn, type EditReport } from "./stages/edit.ts";

// ── Constants ────────────────────────────────────────────────────────────────

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(moduleDir, "..", "..", "skills", "deccy-agent");
const rolesDir = path.join(moduleDir, "roles");

const AUTO_REWORK_ROUNDS = 2;

export const DECCY_EDIT_ROLE = {
  name: "deccy-edit",
  tools: ["read", "bash", "edit", "write"],
  thinkingLevel: "high",
  systemPromptFile: path.join(rolesDir, "deccy-edit.system.md"),
};

const log = (msg: string) => console.error(`[deccy-edit] ${msg}`);

// ── Types ────────────────────────────────────────────────────────────────────

export interface DeccyEditArgs {
  request?: string; // positional
  graphDir?: string; // --graph (default: cwd)
  interactive?: boolean;
  interactiveStreams?: { inputStream?: NodeJS.ReadableStream; outputStream?: NodeJS.WritableStream };
  /** Stream the model's thinking to stderr (default on for one-shot runs). */
  thinking?: boolean;
  model?: string;
  sessionOverrides?: Record<string, StageSessionFactory>;
  /** Injectable deccy/jj runner (tests). */
  runner?: DeccyRunner;
  help?: boolean;
}

export interface EditPayload {
  request?: string;
  /** Human recap(s) of what changed (one per edit turn). */
  summary?: string;
  created?: { id: string; summary?: string; on?: string[]; files: string[] }[];
  edited?: { id: string; files: string[] }[];
  deviations?: string[];
  validation?: string[];
  failed?: boolean;
  reason?: string;
}

// ── CLI parsing ──────────────────────────────────────────────────────────────

function usage(): string {
  return [
    "Usage:",
    "",
    '  node workflows/deccy-edit/index.ts ["<request>"] [--graph <dir>]',
    "       [--interactive] [--no-thinking]",
    "",
    "  Advanced: [--model provider/model[:thinking]]  (-i is an alias for --interactive)",
    "",
    "  Direct edits / node adds on the graph — no .deccy_plan.md. Without a request,",
    "  -i opens a REPL (the request, if given, runs as its first turn).",
    "  One-shot runs stream the model's thinking to stderr; --no-thinking silences it.",
  ].join("\n");
}

export function parseCli(argv: string[]): DeccyEditArgs {
  const args: DeccyEditArgs = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const val = (): string => {
      if (i + 1 >= argv.length) {
        console.error(`missing value for ${flag}\n\n${usage()}`);
        process.exit(2);
      }
      return argv[++i];
    };
    switch (flag) {
      case "--graph":
        args.graphDir = val();
        break;
      case "--interactive":
      case "-i":
        args.interactive = true;
        break;
      case "--no-thinking":
        args.thinking = false;
        break;
      case "--model":
        args.model = val();
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        if (flag.startsWith("-")) {
          console.error(`unknown flag: ${flag}\n\n${usage()}`);
          process.exit(2);
        }
        positional.push(flag);
    }
  }
  if (positional.length > 0) args.request = positional.join(" ");
  return args;
}

// ── Session wiring ───────────────────────────────────────────────────────────

function finalAssistantText(session: any): string {
  const messages: any[] = session.agent.state.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter((c: any) => c && c.type === "text" && typeof c.text === "string")
        .map((c: any) => c.text)
        .join("\n");
    }
    return "";
  }
  return "";
}

async function createSessionFactory(input: DeccyEditArgs): Promise<StageSessionFactory> {
  return async (attempt?: number): Promise<StageSession> => {
    const override = input.sessionOverrides?.[DECCY_EDIT_ROLE.name];
    if (override) return override(attempt);
    const cwd = process.cwd();
    const agentDir = getAgentDir();
    const loader = new DefaultResourceLoader({ cwd, agentDir });
    await loader.reload();
    const modelRuntime = await ModelRuntime.create();
    let model: any;
    let thinkingLevel: any = DECCY_EDIT_ROLE.thinkingLevel;
    if (input.model && input.model.trim()) {
      const resolved = resolveCliModel({ cliModel: input.model.trim(), modelRuntime });
      if (resolved.error) throw new Error(`model "${input.model}" not usable: ${resolved.error}`);
      if (!resolved.model) throw new Error(`model "${input.model}" not found`);
      if (resolved.warning) log(`model warning: ${resolved.warning}`);
      model = resolved.model;
      if (resolved.thinkingLevel) thinkingLevel = resolved.thinkingLevel;
      log(`using model ${resolved.model.provider}/${resolved.model.id} (thinking: ${thinkingLevel})`);
    }
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      ...(model ? { model } : {}),
      thinkingLevel,
      tools: [...DECCY_EDIT_ROLE.tools],
      resourceLoader: loader,
      modelRuntime,
      sessionManager: SessionManager.inMemory(cwd),
    });
    log(`role → ${DECCY_EDIT_ROLE.name} (thinking: ${thinkingLevel}, tools: ${DECCY_EDIT_ROLE.tools.join(", ")})`);
    return {
      prompt: async (p: string) => {
        await session.prompt(p);
        return finalAssistantText(session);
      },
      subscribe: (listener: (event: any) => void) => session.subscribe(listener),
      setTools: (toolNames: string[]) => session.setActiveToolsByName(toolNames),
      close: () => session.dispose(),
    };
  };
}

// ── The editor ───────────────────────────────────────────────────────────────

/** Merge a turn's report into the running payload accumulators (rerun-safe:
 * entries merge by node id, deviations stay unique). */
function mergeReport(into: EditPayload, report: EditReport): void {
  const merge = (
    base: { id: string; files: string[] }[],
    add: { id: string; files: string[] }[],
  ): { id: string; files: string[] }[] => {
    const out = base.map((e) => ({ ...e, files: [...e.files] }));
    for (const a of add) {
      const hit = out.find((x) => x.id === a.id);
      if (hit) hit.files = [...new Set([...hit.files, ...a.files])];
      else out.push({ ...a, files: [...a.files] });
    }
    return out;
  };
  into.created = merge(into.created ?? [], report.created) as EditPayload["created"];
  into.edited = merge(into.edited ?? [], report.edited);
  into.deviations = [...new Set([...(into.deviations ?? []), ...report.deviations])];
  if (report.summary) {
    into.summary = into.summary ? `${into.summary}\n${report.summary}` : report.summary;
  }
}

export async function deccyEdit(input: DeccyEditArgs): Promise<EditPayload> {
  const fail = (reason: string): EditPayload => ({ failed: true, reason, request: input.request });
  const request = (input.request ?? "").trim();
  if (!request) return fail('no request given — pass a positional request (or run with --interactive)');

  const graphDir = path.resolve(process.cwd(), input.graphDir ?? ".");
  const runner = input.runner ?? createProcessRunner(graphDir);
  const { graph, problems, notes } = await loadGraphFromRepo(runner);
  for (const n of notes) log(`note: ${n}`);
  if (problems.length > 0) {
    return fail(`graph has problems — fix them first:\n${problems.join("\n")}`);
  }

  const factory = await createSessionFactory(input);
  const session = await factory();
  const stopThinking = input.thinking === false ? () => {} : streamThinking(session, process.stderr);
  const payload: EditPayload = { request, created: [], edited: [], deviations: [], validation: [], failed: false };
  try {
    let report: EditReport;
    try {
      report = await runEditStage(session, { request, graph, notes, skillDir, rolesDir, graphRoot: graphDir });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
    mergeReport(payload, report);
    for (const d of report.deviations) log(`deviation: ${d}`);

    let hostValidation: HostValidation = await runHostValidators(runner);
    for (let round = 1; round <= AUTO_REWORK_ROUNDS && !hostValidation.ok; round++) {
      log(`validation rework round ${round}/${AUTO_REWORK_ROUNDS}: ${hostValidation.lines.length} problem(s)`);
      for (const l of hostValidation.lines) log(`  - ${l}`);
      report = await runEditStage(session, {
        request,
        graph,
        notes,
        skillDir,
        rolesDir,
        graphRoot: graphDir,
        validationErrors: hostValidation.lines,
      });
      mergeReport(payload, report);
      hostValidation = await runHostValidators(runner);
    }
    payload.validation = hostValidation.lines;

    if (!hostValidation.ok) {
      return {
        ...payload,
        failed: true,
        reason:
          `validation still failing after ${AUTO_REWORK_ROUNDS} rework round(s) — human route: ` +
          hostValidation.lines.join("; "),
      };
    }
  } finally {
    stopThinking();
    session.close?.();
  }
  return payload;
}

// ── Interactive REPL (-i) ────────────────────────────────────────────────────

export async function runEditInteractive(input: DeccyEditArgs): Promise<EditPayload> {
  const request = (input.request ?? "").trim();
  const output = input.interactiveStreams?.outputStream ?? process.stdout;
  const graphDir = path.resolve(process.cwd(), input.graphDir ?? ".");
  const runner = input.runner ?? createProcessRunner(graphDir);
  const { graph, problems, notes } = await loadGraphFromRepo(runner);
  for (const n of notes) log(`note: ${n}`);
  if (problems.length > 0) {
    return { failed: true, reason: `graph has problems: ${problems.join("; ")}`, request };
  }

  const factory = await createSessionFactory(input);
  const session = await factory();
  const payload: EditPayload = { request, created: [], edited: [], deviations: [], validation: [], failed: false };

  const editTurn = async (line: string): Promise<string> => {
    const report = await runEditStage(session, { request: line, graph, notes, skillDir, rolesDir, graphRoot: graphDir });
    mergeReport(payload, report);
    const v = await runHostValidators(runner);
    payload.validation = v.lines;
    return (
      (report.summary ? `${report.summary}\n` : "") +
      `Edit: ${report.created.length} node(s) created, ${report.edited.length} recorded.\n` +
      (report.deviations.length > 0 ? `Deviations:\n${report.deviations.map((d) => `- ${d}`).join("\n")}\n` : "") +
      (v.ok ? "Validation: clean" : `Validation: ${v.lines.length} problem(s)\n` + v.lines.map((l) => `- ${l}`).join("\n"))
    );
  };

  const readOnlyTurn = async (mode: "ask" | "plan", question: string): Promise<string> => {
    if (!question.trim()) return `Usage: /${mode} <${mode === "ask" ? "question" : "task"}>`;
    session.setTools?.(["read"]); // real read-only: mutations are off for this turn
    try {
      return await runReadOnlyTurn(session, { mode, request: question, graph, notes, skillDir });
    } finally {
      session.setTools?.([...DECCY_EDIT_ROLE.tools]);
    }
  };

  try {
    if (request) {
      log("running the positional request as the first turn...");
      output.write(`${await editTurn(request)}\n`);
    }
    await runInteractiveReworkLoop({
      banner:
        `[deccy-edit] interactive edit session.\nGraph: ${graphDir}\n` +
        "Type directives to edit or add nodes, /ask <question> for read-only answers, " +
        "/plan <task> to propose edits without applying, /check to run the validators, " +
        "/status for deccy log, /undo to step back, /exit to quit.",
      promptLabel: "[deccy-edit] > ",
      helpText: `
Available commands:
  /ask <question>   Read-only Q&A about the graph ("summarize the nodes", "who owns src/x.ts").
                    Tools are narrowed to ` + "`read`" + ` for the turn — nothing can be mutated.
  /plan <task>      Read-only planning turn: proposes the edits (per node: fields/files and the
                    ` + "`deccy record`" + ` calls) WITHOUT applying them. Say ` + "`apply`" + ` to execute
                    the plan, or give corrections first.
  /check            Run the validators: ` + "`deccy validate`" + ` + topology/custody checkers (0 LLM).
  /status           Print ` + "`deccy log`" + ` — one line per node: id, kind, summary (0 LLM).
  /undo             Step back with ` + "`deccy undo`" + ` (0 LLM).
  /exit, /quit      Exit the session.
  /help             Show this help message.

Any other input is an edit turn: the directive is applied to the working copy and answered
with a summary of what changed, the nodes touched, any deviations, and the validation state.
\n`,
      inputStream: input.interactiveStreams?.inputStream,
      outputStream: input.interactiveStreams?.outputStream,
      session,
      onCommand: async (cmd, arg) => {
        if (cmd === "/ask") return readOnlyTurn("ask", arg);
        if (cmd === "/plan") return readOnlyTurn("plan", arg);
        if (cmd === "/check") {
          const v = await runHostValidators(runner);
          payload.validation = v.lines;
          return v.ok ? "Validation: clean" : `Validation: ${v.lines.length} problem(s)\n` + v.lines.map((l) => `- ${l}`).join("\n");
        }
        if (cmd === "/status") {
          const res = await runner.deccy(["log"]);
          return (res.stdout || res.stderr).trim() || "(deccy log produced no output)";
        }
        if (cmd === "/undo") {
          const res = await runner.deccy(["undo"]);
          return res.code === 0 ? "deccy undo: done" : `deccy undo failed: ${(res.stderr || res.stdout).trim()}`;
        }
        return `Unknown command: ${cmd}. Type /help for available commands.`;
      },
      onTurn: async (line) => {
        const directive =
          line === "apply" ? "Apply the plan you proposed in your previous message, exactly as outlined." : line;
        return editTurn(directive);
      },
    });
  } finally {
    session.close?.();
  }
  return payload;
}

// ── CLI entrypoint ───────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const args = parseCli(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const payload =
    args.interactive || args.interactiveStreams
      ? await runEditInteractive(args)
      : await deccyEdit(args);
  console.log(JSON.stringify(payload, null, 2));
  return payload.failed ? 1 : 0;
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`[deccy-edit] unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      process.exit(1);
    });
}
