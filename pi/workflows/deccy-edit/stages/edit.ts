// edit — the deccy-edit agent stage: one call (plus at most one corrective
// follow-up) that applies a direct directive to the graph working copy and
// concludes with the enforced ```json edit-report block. No plan artifact, no
// placement phase — the role runs `deccy new` / `deccy record` itself and the
// controller only parses, validates, and reports.

import { readFileSync } from "node:fs";
import path from "node:path";
import { extractJson, type StageSession } from "../../lib/stageJson.ts";
import type { CompiledGraph } from "../../lib/graphReader.ts";
import { toolkitSection } from "../../lib/hostValidators.ts";
import { buildGraphDigest } from "../../lib/graphDigest.ts";

export interface EditArgs {
  /** The directive: what to edit or add (one-shot request or a REPL line). */
  request: string;
  graph: CompiledGraph;
  /** Discovery notes (deccy/jj deviations). */
  notes?: string[];
  /** pi/skills/deccy-agent directory. */
  skillDir: string;
  rolesDir: string;
  /** Absolute path of the target graph repo (for the toolkit section). */
  graphRoot: string;
  /** Host validation output to resolve (bounded rework rounds). */
  validationErrors?: string[];
}

export interface EditReportCreated {
  id: string;
  summary?: string;
  on?: string[];
  files: string[];
}

export interface EditReportEdited {
  id: string;
  files: string[];
}

export interface EditReport {
  /** Human recap of what this run actually changed. */
  summary?: string;
  created: EditReportCreated[];
  edited: EditReportEdited[];
  deviations: string[];
}

export function buildEditPrompt(args: EditArgs): string {
  const skillBody = readFileSync(path.join(args.skillDir, "SKILL.md"), "utf8");
  const roleBody = readFileSync(path.join(args.rolesDir, "deccy-edit.system.md"), "utf8");
  const parts: string[] = [skillBody, "", "---", "", roleBody, "", "---", ""];

  parts.push("# Edit task");
  parts.push("");
  parts.push(`## Request\n${args.request}`);
  parts.push("");
  if (args.validationErrors && args.validationErrors.length > 0) {
    parts.push("## Validation Errors to Resolve");
    parts.push(...args.validationErrors.map((e) => `- ${e}`));
    parts.push("");
    parts.push("Fix exactly these in the owning nodes' files (then `deccy record` each into its node). Do not restructure the graph.");
    parts.push("");
  }
  if (args.notes && args.notes.length > 0) {
    parts.push("## Notes", ...args.notes.map((n) => `- ${n}`), "");
  }
  parts.push(toolkitSection(args.graphRoot));
  parts.push(buildGraphDigest(args.graph));
  parts.push("Conclude with the edit-report block from your instructions.");
  parts.push("");
  return parts.join("\n");
}

export type EditExtract = { ok: true; report: EditReport } | { ok: false; errors: string[] };

export function extractEditReport(text: string): EditExtract {
  const extracted = extractJson(text);
  if (!extracted.ok) return { ok: false, errors: [extracted.reason] };
  const value = extracted.value as Partial<EditReport> & { kind?: string };
  if (!value || typeof value !== "object" || (!Array.isArray(value.created) && !Array.isArray(value.edited))) {
    return { ok: false, errors: ['edit report must be {"kind":"edit-report","created":[...],"edited":[...],"deviations":[...]}'] };
  }
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  const created: EditReportCreated[] = [];
  for (const c of value.created ?? []) {
    if (!c || typeof c !== "object" || typeof (c as any).id !== "string") {
      return { ok: false, errors: ["every edit-report created entry needs a string id"] };
    }
    const entry = c as Partial<EditReportCreated>;
    created.push({
      id: entry.id!,
      ...(typeof entry.summary === "string" ? { summary: entry.summary } : {}),
      ...(Array.isArray(entry.on) ? { on: strList(entry.on) } : {}),
      files: strList(entry.files),
    });
  }
  const edited: EditReportEdited[] = [];
  for (const e of value.edited ?? []) {
    if (!e || typeof e !== "object" || typeof (e as any).id !== "string") {
      return { ok: false, errors: ["every edit-report edited entry needs a string id"] };
    }
    edited.push({ id: (e as EditReportEdited).id, files: strList((e as EditReportEdited).files) });
  }
  return {
    ok: true,
    report: {
      ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
      created,
      edited,
      deviations: strList(value.deviations),
    },
  };
}

/** One edit call (+ at most one corrective follow-up). */
export async function runEditStage(session: StageSession, args: EditArgs): Promise<EditReport> {
  const reply = await session.prompt(buildEditPrompt(args));
  let extracted = extractEditReport(reply);
  if (!extracted.ok) {
    const corrective = await session.prompt(
      "Your previous answer could not be used (" +
        extracted.errors.join("; ") +
        '). Respond again concluding with ONLY a fenced ```json block {"kind":"edit-report","created":[...],"edited":[...],"deviations":[...]}.',
    );
    extracted = extractEditReport(corrective);
    if (!extracted.ok) throw new Error(`edit report unusable: ${extracted.errors.join("; ")}`);
  }
  return extracted.report;
}

// ── Read-only turns (/ask, /plan) ───────────────────────────────────────

export interface ReadOnlyArgs {
  /** "ask": answer a question. "plan": propose edits without applying them. */
  mode: "ask" | "plan";
  request: string;
  graph: CompiledGraph;
  notes?: string[];
  /** pi/skills/deccy-agent directory. */
  skillDir: string;
}

export function buildReadOnlyPrompt(args: ReadOnlyArgs): string {
  const skillBody = readFileSync(path.join(args.skillDir, "SKILL.md"), "utf8");
  const parts: string[] = [skillBody, "", "---", ""];
  if (args.mode === "ask") {
    parts.push(
      "# READ-ONLY question turn",
      "",
      "Answer the engineer's question about the graph below. This is a READ-ONLY turn: do NOT edit",
      "files and do NOT run `deccy new` / `deccy record` or any other mutation — no edit-report block",
      "is expected. Ground the answer in the graph digest and your read tool (nodes/*.json, repo files).",
      "",
    );
  } else {
    parts.push(
      "# READ-ONLY planning turn",
      "",
      "Propose how to apply the task below WITHOUT applying anything. This is a READ-ONLY turn: do NOT",
      "edit files and do NOT run `deccy new` / `deccy record` or any other mutation — no edit-report",
      "block is expected.",
      "",
      "Output a short markdown plan — one bullet per node with (a) what changes (content fields or",
      "files), (b) the `deccy record <path>... --to <id>` call that would place it, and (c) any",
      "`deccy new` needed (with its `--on` prerequisites). Note foreseeable deviations.",
      'Conclude with: "Say `apply` to execute this plan, or give corrections first."',
      "",
    );
  }
  parts.push(`## Request\n${args.request}`);
  parts.push("");
  if (args.notes && args.notes.length > 0) {
    parts.push("## Notes", ...args.notes.map((n) => `- ${n}`), "");
  }
  parts.push(buildGraphDigest(args.graph));
  return parts.join("\n");
}

/** One read-only call — the raw answer, no report seam (nothing was mutated). */
export async function runReadOnlyTurn(session: StageSession, args: ReadOnlyArgs): Promise<string> {
  return session.prompt(buildReadOnlyPrompt(args));
}
