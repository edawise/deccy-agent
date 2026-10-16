---
name: deccy-agent
description: Work on projects that use a deccy (decision) graph. Load when placing, editing, linking or evaluating decision/evaluation nodes, reasoning about why things are the way they are, or doing graph work with the deccy CLI (deccy new/record/validate, node files, eval-sandwich invariants).
---

# Deccy graph work

A **deccy** graph (a decision graph) is a directed acyclic graph where **one change = one node = one decision**.
Work with it deliberately: every edit to the project should land in the right node(s), and every
dependency edge should be evaluation-covered.

Graph work goes through the `deccy` CLI, never hand-rolled change surgery. Read
`references/deccy-workflow.md` before touching any node. Read `references/decision-placement.md`
before deciding *where* a change goes. Read `references/evaluations.md` when adding or covering
`depends_on` edges (per-cell form guidance: `references/eval-cells.md`).

## 1. Discover the project first

The CLI fixes the layout, so there is little to discover:

1. The node directory is `nodes/`, one `<change-id>.json` file per node.
2. The root id is `zzzzzzzz` — the sole dependency of a root node (a node with no other
   prerequisite).
3. The node schema is embedded in the `deccy` binary and checked by `deccy validate`; there is no
   schema file to read.
4. Confirm `deccy` is on PATH and read the graph: `deccy log` lists every node as
   `<id> <kind> <summary>`, and `deccy show <id>` prints a node's stored document.

If a project lacks any of these (for example, it is not initialised for deccy), note the deviation
explicitly rather than silently imposing the canonical layout.

## 2. The model

- **Kinds.** `decision`: one decided unit of work — what was decided and why. `evaluation`:
  review criteria, tests, other quality checks.
- **Node content.** `{ "type", "ref", "rationale" }`, plus inline `content` only when `ref` is
  `"inline"`. Otherwise `ref` is a list of repo-relative paths carrying the content (e.g. source
  files); the node JSON records *what and why*, not the code itself. `type` names the format of the
  content — `text`, `ears`, `visual-spec`, `json-schema`, `test`, `review-criteria`, and others as
  projects invent them.
- **Edges.** `depends_on` (decision → decision/evaluation) declares a prerequisite. `evaluates`
  (evaluation → decision/evaluation) declares what is evaluated.
- **Change ids are stable across rebases; commit ids are not.** Node filenames use change ids, and a
  node is addressed by that id everywhere — in `deccy` verbs and in edge targets.

## 3. Invariants (the target model — enforce, even if the current graph falls short)

- **I1.** One change = one node = one decision. Never two decisions in one change; never one
  decision split across two changes.
- **I2.** Every decision has ≥1 `depends_on`. Root decisions depend on `zzzzzzzz`. Decisions never
  carry `evaluates`.
- **I3.** Every evaluation has ≥1 `evaluates`. Evaluations may additionally carry `depends_on`.
- **I4 (eval sandwich).** Every `depends_on` edge `A → B` between decisions is covered by ≥1
  evaluation node `E` with `E.evaluates ∋ A` **and** `E.depends_on ∋ B`: the evaluation checks that
  *A's use of B is sound*. One `E` may cover several edges (`evaluates: [A]`,
  `depends_on: [B1, B2]`), but coverage must be complete. Evaluations are heavily present — expect
  more evaluation nodes than decisions.
- **I5.** Evaluations describe *how the check is done* (criteria, commands, test refs). They do not
  record outcomes or verdicts.
- **I6 (content custody).** A change never modifies files listed in another node's `ref` or another
  node's `nodes/<id>.json` — no rides, no unref'd lines in a sibling's file. The file carries that
  node's content; the change carries its own node's content and nothing else's. `deccy record`
  enforces custody at the door for recorded edits (it refuses a path the target does not own); the
  script below catches anything else.

Check before finishing any graph work:

```sh
# schema validity, edge resolution, and I4 coverage, in one pass (silent when clean)
deccy validate
# topological order: every prerequisite precedes its dependent (read-only)
scripts/check-topology.py
# content custody: no change touches another node's ref'd files or node file (read-only)
scripts/check-ref-custody.py
# every decision has depends_on; every evaluation has evaluates
jq -e 'select(.kind=="decision") | has("depends_on")' nodes/*.json >/dev/null
jq -e 'select(.kind=="evaluation") | has("evaluates")' nodes/*.json >/dev/null
```

`deccy validate` covers validity, resolution and I4 coverage only; it does **not** check topology
or custody — those are the two read-only scripts (failure line format: `references/deccy-workflow.md`).

## 4. Where a change goes (placement)

Before editing, identify the decision(s) at play, including level: a higher-order decision is
elaborated by lower-level ones, each its own node (full procedure and worked examples:
`references/decision-placement.md`). Then:

- Changes what an existing node decided → **edit that node** (record flow,
  `references/deccy-workflow.md`); never add a near-duplicate node.
- A new decision → **new node** (`deccy new`, positioned after its dependencies) with `depends_on`
  naming them; never fold it into an existing node's change, even when the code lives in the same
  files.
- Touches files listed in another node's `ref` → you are changing that node's decision: record the
  touch into it if it serves that decision, otherwise it is a new node. When unsure, new node.
- A check (test, criterion, measurement) → evaluation node, wired per I4
  (`references/evaluations.md`).
- One change carrying two decisions → split it (`references/decision-placement.md`).

Smells and their fixes (`references/decision-placement.md`): a rationale in node X arguing a
different decision than X records; code changed with no node created or edited; a new `depends_on`
edge with no covering evaluation; a prerequisite positioned after its dependent in history.

## 5. Worked example

Feature: full-text search over the library of a Markdown document viewer.

Already in the graph: `A` — "documents are Markdown files on disk; the app watches the library
directory and reloads on change" (`depends_on: [zzzzzzzz]`), and `H` — "the toolbar hosts the
library actions" (with `ref` covering `src/ui/toolbar.tsx`).

New decisions, each its own node created with `deccy new --on` and filled in place:

- `B` — "search is served by a SQLite FTS5 index, rebuilt incrementally off the existing
  file-watch events". `content.type: "text"`, `ref: ["src/search/index.ts",
  "src/search/watch-hook.ts"]`, rationale: "FTS5 gives ranked results and incremental updates;
  re-scanning the library per keystroke won't scale past a few hundred files".
  `depends_on: [A]` — the index reads A's files and hooks A's watch events.
- `C` — "the search box lives in the toolbar: 150ms debounce, top-8 results with snippet
  highlights, empty query shows recent documents". `content.type: "text"`, `ref:
  ["src/ui/search-box.tsx", "src/ui/snippets.ts"]`, rationale: "debounce keeps typing smooth
  against a large index; eight highlighted results fit the panel without scrolling".
  `depends_on: [B, H]` — it queries the index API `B` defines and mounts into the toolbar `H`
  owns. Mounting needs a small edit to `src/ui/toolbar.tsx`, which is `H`'s `ref`'d file: that
  edit serves `C`'s purpose, not `H`'s decision, so it is recorded into `C`, not `H`.
- `E1` — covers edge `B → A`: `content.type: "test"`, `ref: ["tests/search-index.spec.ts"]`,
  rationale: "index returns ranked results and stays current across file edits and deletes",
  `evaluates: [B]`, `depends_on: [A]`.
- `E2` — covers edges `C → B` and `C → H` together: `content.type: "test"`, `ref:
  ["tests/search-ui.spec.ts"]`, rationale: "results reflect the index and the box mounts cleanly
  in the toolbar layout", `evaluates: [C]`, `depends_on: [B, H]`. One eval covers two edges
  because a single UI test gates both uses.

Notes: the mount edit to `src/ui/toolbar.tsx` serves `C`'s purpose rather than `H`'s recorded
decision, so it is placed into `C`'s change (`deccy record src/ui/toolbar.tsx --to C`) rather than
`H`'s. Lower-level decisions elaborating `B` or `C` (tokenizer behaviour, debounce tuning) get
their own nodes via `deccy new --on B` (or `--on C`) as they arise, rather than bloating the
higher-order nodes.

## 6. deccy playbook

The exact CLI workflows — `new`, `record`, buffer edits, `remove`, read/check, `undo`/`redo`, and
the one raw-jj exception (`jj describe` for a change summary) — live in
`references/deccy-workflow.md`. Read that file before touching any node; this skill does not
duplicate its command details.
