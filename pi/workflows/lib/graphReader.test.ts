// graphReader tests — compilation, unambiguous prefix resolution, custody
// lookups, and broken-document reporting (nothing is silently dropped).

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { compileGraph, loadNodeDocs, ROOT_ID } from "./graphReader.ts";
import { fixtureEntries, fixtureDir, fixtureGraph } from "./fixtures/graph/fixtureGraph.ts";

test("fixture graph compiles with kinds, edges and refs", () => {
  const g = fixtureGraph();
  assert.equal(g.nodes.size, 6);
  assert.equal(g.nodes.get("bfts5x03")!.kind, "decision");
  assert.deepEqual(g.nodes.get("csrchb04")!.depends_on, ["bfts5x03", "htoolb02"]);
  assert.deepEqual(g.nodes.get("euicov06")!.evaluates, ["csrchb04"]);
  assert.deepEqual(g.nodes.get("bfts5x03")!.content.ref, ["src/search/index.ts", "src/search/watch-hook.ts"]);
  assert.equal(g.summary("adocsw01"), fixtureEntries().find((e) => e.id === "adocsw01")!.summary);
});

test("resolution is unambiguous prefix matching", () => {
  const g = fixtureGraph();
  assert.deepEqual(g.resolve("bfts5x03"), { ok: true, id: "bfts5x03" });
  assert.deepEqual(g.resolve("bfts5x"), { ok: true, id: "bfts5x03" });
  const ambiguous = g.resolve("e");
  assert.equal(ambiguous.ok, false);
  const missing = g.resolve("zzzz");
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.reason, /no node matches/);
});

test("historyOrder sorts oldest → newest from positions", () => {
  const g = fixtureGraph();
  assert.deepEqual(g.historyOrder, ["adocsw01", "htoolb02", "bfts5x03", "eidxcv05", "csrchb04", "euicov06"]);
});

test("refOwners implements the single-owner custody lookup", () => {
  const g = fixtureGraph();
  assert.deepEqual(g.refOwners("src/ui/toolbar.tsx"), ["htoolb02"]);
  assert.deepEqual(g.refOwners("tests/search-index.spec.ts"), ["eidxcv05"]);
  assert.deepEqual(g.refOwners("src/unowned.ts"), []);
});

test("loadNodeDocs reports broken documents instead of dropping them", () => {
  const { entries, problems } = loadNodeDocs(path.join(fixtureDir(), "no-such-dir"));
  assert.equal(entries.length, 0);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /cannot read node directory/);
});

test("compileGraph reports documents with unusable kind/content", () => {
  const { graph, problems } = compileGraph([
    { id: "goodnode", doc: { kind: "decision", depends_on: [ROOT_ID], content: { type: "text", ref: "inline", content: "x", rationale: "r" } } },
    { id: "badkind1", doc: { kind: "feature", content: { type: "text", ref: "inline", content: "x", rationale: "r" } } },
    { id: "nodoc11", doc: "not an object" },
  ]);
  assert.equal(graph.nodes.size, 1);
  assert.equal(problems.length, 2);
  assert.ok(problems.some((p) => /badkind1/.test(p) && /kind/.test(p)));
  assert.ok(problems.some((p) => /nodoc11/.test(p)));
});
