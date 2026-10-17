// graphReader — deterministic (0 LLM) compilation of a deccy graph working
// copy: nodes/<change-id>.json documents plus optional summary text (the node
// schema has no summary field; summaries live in the owning jj change's
// description and arrive via `deccy log`) and optional history order (jj log
// positions; larger position = newer).
//
// Pure logic in `compileGraph`; only `loadNodeDocs` touches the filesystem.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const ROOT_ID = "zzzzzzzz";

export interface NodeContent {
  type: string;
  ref: "inline" | string[];
  rationale: string;
  content?: string;
  [k: string]: unknown;
}

export interface GraphNode {
  /** Change id (the node file's stem, 8+ chars). */
  id: string;
  kind: "decision" | "evaluation";
  depends_on: string[];
  evaluates: string[];
  content: NodeContent;
  /** Change description (jj), when known. */
  summary?: string;
  /** History position: larger = newer, when known. */
  pos?: number;
}

export interface GraphEntry {
  id: string;
  doc: unknown;
  summary?: string;
  pos?: number;
}

export interface LoadResult {
  entries: GraphEntry[];
  /** Unreadable node files (never silently dropped). */
  problems: string[];
}

/** Read every nodes/*.json document. Broken JSON is reported, not fatal here —
 * callers decide (the planner notes the deviation; the executor refuses). */
export function loadNodeDocs(nodesDir: string): LoadResult {
  const entries: GraphEntry[] = [];
  const problems: string[] = [];
  let names: string[];
  try {
    names = readdirSync(nodesDir).filter((n) => n.endsWith(".json")).sort();
  } catch (err) {
    return { entries, problems: [`cannot read node directory ${nodesDir}: ${err instanceof Error ? err.message : String(err)}`] };
  }
  for (const name of names) {
    const id = path.basename(name, ".json");
    const file = path.join(nodesDir, name);
    try {
      entries.push({ id, doc: JSON.parse(readFileSync(file, "utf8")) });
    } catch (err) {
      problems.push(`${file}: unreadable node document: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { entries, problems };
}

export type ResolveResult =
  | { ok: true; id: string }
  | { ok: false; reason: string };

export interface CompiledGraph {
  /** Node documents by exact change id (filename stem). */
  nodes: Map<string, GraphNode>;
  /** All ids, sorted for determinism. */
  ids: string[];
  /** Ids ordered oldest → newest when history positions were supplied. */
  historyOrder: string[];
  /** Unambiguous prefix resolution, like check-ref-custody.py. */
  resolve(prefix: string): ResolveResult;
  /** Nodes whose content.ref lists this repo-relative path (single-owner). */
  refOwners(repoPath: string): string[];
  /** History position (larger = newer), or undefined when unknown. */
  pos(id: string): number | undefined;
  /** Summary (jj change description) when known. */
  summary(id: string): string | undefined;
}

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/**
 * Compile graph entries into a typed, resolvable graph. Documents that do not
 * carry a usable `kind` are kept out of the node map and reported through
 * `problems` so nothing is silently smaller than the working copy.
 */
export function compileGraph(entries: GraphEntry[]): { graph: CompiledGraph; problems: string[] } {
  const nodes = new Map<string, GraphNode>();
  const problems: string[] = [];
  for (const e of entries) {
    const doc = e.doc as Record<string, unknown> | null;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      problems.push(`node ${e.id}: document is not a JSON object`);
      continue;
    }
    const kind = doc.kind;
    if (kind !== "decision" && kind !== "evaluation") {
      problems.push(`node ${e.id}: kind must be "decision" or "evaluation", got ${JSON.stringify(kind)}`);
      continue;
    }
    const content = doc.content as NodeContent | undefined;
    if (!content || typeof content !== "object") {
      problems.push(`node ${e.id}: missing content object`);
      continue;
    }
    nodes.set(e.id, {
      id: e.id,
      kind,
      depends_on: asStringArray(doc.depends_on),
      evaluates: asStringArray(doc.evaluates),
      content,
      summary: e.summary,
      pos: e.pos,
    });
  }

  const ids = [...nodes.keys()].sort();
  const historyOrder = ids
    .filter((id) => nodes.get(id)!.pos !== undefined)
    .sort((a, b) => nodes.get(a)!.pos! - nodes.get(b)!.pos!);

  return {
    problems,
    graph: {
      nodes,
      ids,
      historyOrder,
      resolve(prefix: string): ResolveResult {
        if (nodes.has(prefix)) return { ok: true, id: prefix };
        const matches = ids.filter((id) => id.startsWith(prefix));
        if (matches.length === 1) return { ok: true, id: matches[0] };
        if (matches.length === 0) return { ok: false, reason: `no node matches "${prefix}"` };
        return { ok: false, reason: `"${prefix}" is ambiguous (${matches.join(", ")})` };
      },
      refOwners(repoPath: string): string[] {
        const owners: string[] = [];
        for (const id of ids) {
          const ref = nodes.get(id)!.content.ref;
          if (Array.isArray(ref) && ref.includes(repoPath)) owners.push(id);
        }
        return owners;
      },
      pos(id: string): number | undefined {
        return nodes.get(id)?.pos;
      },
      summary(id: string): string | undefined {
        return nodes.get(id)?.summary;
      },
    },
  };
}
