// fixtureGraph — the SKILL.md §5 worked example graph (A, H, B, C, E1, E2)
// as node fixtures plus the summaries/history order the node schema keeps
// outside the documents (jj change descriptions and positions).
//
// History order (older → newer): A, H, B, E1, C, E2.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileGraph, loadNodeDocs, type CompiledGraph, type GraphEntry } from "../../graphReader.ts";

export const FIXTURE_SUMMARIES: Record<string, string> = {
  adocsw01: "documents are Markdown files on disk; the app watches the library directory and reloads on change",
  htoolb02: "the toolbar hosts the library actions",
  bfts5x03: "search is served by a SQLite FTS5 index, rebuilt incrementally off the existing file-watch events",
  csrchb04: "the search box lives in the toolbar: 150ms debounce, top-8 results with snippet highlights, empty query shows recent documents",
  eidxcv05: "E1: index stays current across file edits and deletes (covers B → A)",
  euicov06: "E2: results reflect the index and the box mounts cleanly in the toolbar layout (covers C → B, C → H)",
};

/** History position, larger = newer. */
export const FIXTURE_POS: Record<string, number> = {
  adocsw01: 1,
  htoolb02: 2,
  bfts5x03: 3,
  eidxcv05: 4,
  csrchb04: 5,
  euicov06: 6,
};

export function fixtureDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

export function fixtureEntries(): GraphEntry[] {
  const { entries, problems } = loadNodeDocs(path.join(fixtureDir(), "nodes"));
  if (problems.length > 0) throw new Error(`fixture graph broken: ${problems.join("; ")}`);
  for (const e of entries) {
    e.summary = FIXTURE_SUMMARIES[e.id];
    e.pos = FIXTURE_POS[e.id];
  }
  return entries;
}

export function fixtureGraph(): CompiledGraph {
  const { graph, problems } = compileGraph(fixtureEntries());
  if (problems.length > 0) throw new Error(`fixture graph broken: ${problems.join("; ")}`);
  return graph;
}
