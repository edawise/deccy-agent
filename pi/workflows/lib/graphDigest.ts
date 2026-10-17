// graphDigest — host-built graph digest for agent prompts: id/kind/summary/
// edges/refs + a rationale excerpt per node. Shared by the deccy-edit and
// deccy-planner stages; the digest is derived, never authored (0 LLM).

import type { CompiledGraph } from "./graphReader.ts";

/** Host-built graph digest: id/kind/summary/edges/refs + rationale excerpt. */
export function buildGraphDigest(graph: CompiledGraph): string {
  const nodes = graph.ids.map((id) => {
    const n = graph.nodes.get(id)!;
    return {
      id,
      kind: n.kind,
      summary: n.summary ?? null,
      depends_on: n.depends_on,
      evaluates: n.evaluates,
      ref: n.content.ref,
      rationale: n.content.rationale.slice(0, 160),
    };
  });
  return [
    "Graph digest (compiled from nodes/*.json + deccy log + jj history; node filenames are authoritative):",
    "```json",
    JSON.stringify({ nodes }, null, 2),
    "```",
    "",
  ].join("\n");
}
