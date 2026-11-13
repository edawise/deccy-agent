---
name: deccy-core
description: Core model and invariants for deccy decision graphs. Load before any deccy graph work; the role skill defines what this agent may do.
disable-model-invocation: true
metadata:
  opencode/autoinvoke: false
---

# Deccy core

This is the shared model skill for the multi-agent round. Load it first, every time.
It defines the graph; your role skill defines your authority and procedure.

## Read first

- `references/model.md` — kinds, content, edges, ids, invariants I1–I6.
- `references/placement.md` — which node a change belongs in.
- `references/cli.md` — the deccy CLI workflows for **deccy-cli v0.2.2**: `new --evaluates`, the
  `draft` / `drafts` / `discard` verbs, and the `record --from` landing form. In a round, only the
  orchestrator runs graph-mutating verbs (`new`, `record`, `remove`, `undo`, `redo`); it also opens
  and ends drafts. Drafters and gate authors edit files in their own draft workspace; the judge is
  read-only on the graph and may open/discard its own clean-room drafts.

## Discover the project

1. The node directory is `nodes/`, one `<change-id>.json` per node.
2. The root id is `zzzzzzzz`.
3. The schema is embedded in the `deccy` binary; `deccy validate` checks it.
4. Confirm `deccy` is on PATH and is **0.2.2 or newer** (`deccy --version`): `new --evaluates`,
   `draft`, `drafts`, `discard` and `record --from` are v0.2.2 features.
5. Read the graph with `deccy log` and `deccy show <id>`, and the draft registry with
   `deccy drafts`.
6. If the project lacks this layout, say so explicitly; do not silently impose it.

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
CORE="<deccy-core skill base directory>"
deccy validate
python3 "$CORE/scripts/check-topology.py" [repo-root]
python3 "$CORE/scripts/check-ref-custody.py" [repo-root]
```

`<deccy-core skill base directory>` is the installed deccy-core skill directory:
`~/.config/opencode/skills/deccy-core` for OpenCode, `~/.claude/skills/deccy-core` for Claude
Code, `~/.agents/skills/deccy-core` for Codex, `~/.pi/agent/skills/deccy-core` for Pi, or
`<project>/.claude/skills/deccy-core` / `<project>/.opencode/skills/deccy-core` /
`<project>/.agents/skills/deccy-core` / `<project>/.pi/skills/deccy-core` when linked
per-project.

In v0.2.2 `validate` covers schema validity, edge resolution and I4 coverage (not topology). The
scripts are read-only and cover topological order and custody. Run the custody script **only when
no draft is open** (`deccy drafts` shows no `open` row); a draft by design edits files outside the
eventual target's ownership.

## Placement in one paragraph

The work changes what an existing node decided → edit that node. The work is a new decision → new
node in a new change, after its dependencies. The work touches another node's `ref` file → either
the touch serves that node's decision (record it there) or it is a different decision (new node);
when unsure, new node. A check is an evaluation node wired per I4, born with `deccy new ...
--evaluates <subject>` so `kind` and `evaluates` are structural. One change carrying two decisions
is a split, not a judgement call. Full procedure: `references/placement.md`.

## CLI map

| Need | Command | Who |
|---|---|---|
| Read | `deccy log`, `deccy show <id>` | everyone |
| Check | `deccy validate` | everyone |
| New decision | `deccy new -m "<summary>" --on <id> --on <id>` | orchestrator only |
| New evaluation | `deccy new -m "<summary>" --on <standard> --evaluates <subject>` | orchestrator only |
| Place edits | `deccy record <path>... --to <id>` | orchestrator only |
| Open a draft | `deccy draft <node>... [--edit <id>]` | orchestrator; judge for clean-room drafts |
| List drafts | `deccy drafts` | everyone |
| Land a draft | `deccy record --from <handle> --to <id> [<path>...]` | orchestrator only |
| End a draft | `deccy discard <handle>...` | orchestrator; judge for its own drafts |
| Remove | `deccy remove <id>` | orchestrator only |
| Recover | `deccy undo` / `deccy redo` | orchestrator only |

`deccy new` makes the new node's change the working copy and writes the skeleton; `--evaluates`
makes it an evaluation in the same call. `deccy record` moves named working-copy edits into an
older node's change and enforces ownership at the door. `deccy draft` opens an isolated workspace
with its own record; `deccy record --from` lands it with a staleness check; `deccy discard` ends it
without landing. The full rules are in `references/cli.md`.

## Non-negotiables

- Never hand-roll graph surgery. `deccy new`/`record`/`remove` own it, and
  `deccy draft`/`discard`/`record --from` own draft isolation and landing. Raw `jj` is limited to
  refresh, restack, workspace listing/forgetting and the verified cleanup scripts.
- Never edit a file listed in another node's `ref` and then record it into your node.
- Never store a red/green verdict in a node. Evidence belongs in the session and the round report.
- Stop when the decision or edge is missing; place it first. Do not encode a guess in a lower gate.
