---
name: Deccy core
description: Core model and invariants for deccy decision graphs. Load before any deccy graph work; the role skill defines what this agent may do.
metadata:
  opencode/autoinvoke: false
---

# Deccy core

This is the shared model skill for the multi-agent round. Load it first, every time.
It defines the graph; your role skill defines your authority and procedure.

## Read first

- `references/model.md` — kinds, content, edges, ids, invariants I1–I6.
- `references/placement.md` — which node a change belongs in.
- `references/cli.md` — the deccy CLI workflows. In a round, only the orchestrator runs mutating
  verbs (`new`, `record`, `remove`, `undo`, `redo`); drafters and gate authors edit files in their
  own workspace; the judge is read-only.

## Discover the project

1. The node directory is `nodes/`, one `<change-id>.json` per node.
2. The root id is `zzzzzzzz`.
3. The schema is embedded in the `deccy` binary; `deccy validate` checks it.
4. Confirm `deccy` is on PATH and read the graph: `deccy log`, `deccy show <id>`.
5. If the project lacks this layout, say so explicitly; do not silently impose it.

## Invariants at a glance

- **I1** one change = one node = one decision.
- **I2** every decision has ≥1 `depends_on`; roots depend on `zzzzzzzz`; decisions never
  `evaluate`.
- **I3** every evaluation has ≥1 `evaluates`.
- **I4** every decision→decision `depends_on` edge is covered by an evaluation that evaluates the
  dependent and depends on the prerequisite.
- **I5** evaluations describe the check, never a verdict.
- **I6** a change never touches another node's `ref` files or `nodes/<id>.json`.

## Check before finishing

```sh
deccy validate
python3 scripts/check-topology.py
python3 scripts/check-ref-custody.py
```

`validate` covers schema validity, edge resolution and I4 coverage. The scripts are read-only and
cover topological order and custody. Run the custody script **only when no draft workspaces are
open**; a draft by design edits files outside the eventual target's ownership.

## Placement in one paragraph

The work changes what an existing node decided → edit that node. The work is a new decision → new
node in a new change, after its dependencies. The work touches another node's `ref` file → either
the touch serves that node's decision (record it there) or it is a different decision (new node);
when unsure, new node. A check is an evaluation node wired per I4. One change carrying two
decisions is a split, not a judgement call. Full procedure: `references/placement.md`.

## CLI map

| Need | Command | Who |
|---|---|---|
| Read | `deccy log`, `deccy show <id>` | everyone |
| Check | `deccy validate` | everyone |
| New node | `deccy new -m "<summary>" --on <id> --on <id>` | orchestrator only |
| Place edits | `deccy record <path>... --to <id>` | orchestrator only |
| Remove | `deccy remove <id>` | orchestrator only |
| Recover | `deccy undo` / `deccy redo` | orchestrator only |

`deccy new` makes the new node's change the working copy and writes the skeleton. `deccy record`
moves named working-copy edits into an older node's change and enforces ownership at the door. The
full rules, including the buffer-change form, are in `references/cli.md`; in the
round the orchestrator uses the jj-direct protocol instead of hand-rolling buffers.

## Non-negotiables

- Never hand-roll graph surgery. `deccy new`/`record`/`remove` own it; the round adds
  a narrow, documented jj workspace protocol for drafts.
- Never edit a file listed in another node's `ref` and then record it into your node.
- Never store a red/green verdict in a node. Evidence belongs in the session and the round report.
- Stop when the decision or edge is missing; place it first. Do not encode a guess in a lower gate.
