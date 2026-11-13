# Draft workspaces (deccy-cli v0.2.2)

The round uses the CLI's draft lifecycle for isolation. The CLI writes the graph, the workspace and
the draft record; jj never writes the graph. This file records the exact surface and the traps found
while running the round on deccy-cli 0.2.2 with jj 0.45.x.

## The model

```text
trunk @  (the round-tip change)
   |
   +-- decision node D
   |      |
   |      +-- gate evaluation E   (a child of D after the topology restack)
   |
   +-- draft workspace @          (a child of D, with E's gate paths restored)
         |
         +-- .deccy/work/<handle>.json   (open -> landed)
```

A draft is **two things**:

- a jj workspace at `~/.local/share/deccy/workspaces/<repository-namespace>/<handle>`, whose `@` is
  a child of the named node's change;
- a record at `.deccy/work/<handle>.json` in the trunk, with `state` (`open` / `landed`), `node`,
  `edit`, `workspace` and `base` (one content identity per owned path).

`deccy drafts` is the record oracle; `jj workspace list` is the workspace oracle. They must agree
except for a `drifted` row, which is a stop.

## Opening

```sh
cd <repo-root>
read -r HANDLE WS <<EOF
$(deccy draft <node-id> --edit "$ROUND_EDIT")
EOF
```

- `deccy draft` prints one `<handle> <workspace path>` line per named node, in the order given.
- A node named twice opens two drafts. Alternatives are two calls on the same node.
- The workspace's `@` is a child of `<node-id>`: the node's content and all its ancestors are in the
  tree. For an implementation draft, `deccy draft <decision>` carries the decision skeleton and its
  prerequisites; for a refine, `deccy draft <target>` carries the target's current state. For a gate,
  `deccy draft <evaluation>` carries the evaluation's skeleton and its prerequisites.
- The evaluation is a **child** of its subject after the topology restack (§5.5), so an
  implementation draft does not carry the gate. Restore the frozen gate paths into it for running;
  they are not landable.
- Open from the **trunk**, and pass `--edit "$ROUND_EDIT"` — the round's empty working-copy change.
  The default `edit` is the invoking change; after a skeleton pass that may be a node.
- The workspace root is fixed by the CLI (`$HOME/.local/share/deccy/workspaces/...`). Do not move
  it; the guards allow that root. A draft workspace is never inside the repository: the trunk
  working copy would see its files and `jj diff` would report `.deccy/...` paths.
- Opening writes no graph state and no marker. `deccy undo` does not undo it.

## Working in a draft

Run jj from **inside** the workspace:

```sh
cd "$WS"
jj workspace update-stale      # after any landing below/above
jj status                      # snapshot; makes edits visible to other workspaces
jj diff --summary -r @         # the draft's changed paths
```

The draft is the workspace's `@`. Do not run `jj new` inside it: a child change would redefine what
"the draft" means. Do not hand-edit `.deccy/work/*.json`; the CLI owns the registry.

For an **implementation draft** (new unit or refine), restored gate paths are for running only:

```sh
[ -n "$GATE_PATHS" ] && jj restore --from "$EVAL_ID" --to @ -- $GATE_PATHS
```

The evaluation follows its subject after the restack, so the gate is not in the draft tree. Never
edit a gate path, and never land one: the CLI's landable set is the subject's owned set plus refs
its node document adds.

## Landing

```sh
cd <repo-root>
deccy record --from "$HANDLE" --to "$TARGET"
deccy validate
jj workspace forget "draft-$HANDLE"
```

- `record --from` is the only landing path. It reads the draft workspace, compares the changed
  landable set with the target, squashes the draft's `@` into the target, and turns the record
  `landed`. Success is silent.
- The **landable set** is the target's current owned set (node JSON + `ref` paths) unioned with the
  `ref` paths the draft's node document adds. A new ref lands in the same call as the node JSON;
  do not split it. `deccy undo` removes the added path as part of the same recording.
- Optional paths assert the changed landable set exactly. Use `$DRAFT_PATHS` when paths are simple;
  the CLI quotes nothing, so a path with spaces is best left out of the assertion.
- The landing keeps the destination's summary (`--use-destination-message`); the node's description
  is unchanged.
- `record --from` refuses a stale draft: an open record naming the same node whose base differs from
  the node's current owned content. It names the handle and the differing paths. Discard it and
  re-open; never `jj squash` or `jj restore` around the refusal.
- The draft workspace's `@` becomes an empty change. `deccy discard` refuses a landed record, so
  forget the workspace with `jj workspace forget "draft-$HANDLE"` and let the close-out cleanup
  abandon the empty head. The landed record stays in `.deccy/work` (v0.2.2 has no prune verb).

## Discarding

```sh
cd <repo-root>
deccy discard "$HANDLE" ["$HANDLE"...]
```

Run from the trunk. It ends each **open** draft without landing it: abandons the workspace's change,
forgets the workspace, removes the directory, removes the record. A handle that names no open record
refuses the whole call before anything is touched. Use it for rejected candidates, losing
alternatives, check drafts and judge drafts. It writes no marker, so it is not an undo unit.

## Refreshing after a landing

A landing rewrites every change above the target. Every other open draft may be stale:

```sh
cd "$WS"
jj workspace update-stale
jj status
jj diff --summary -r @        # must still be the draft you think it is
```

Then re-run its gate. A conflict means the draft was built on a base that no longer exists: discard
it and open a fresh draft from the current node.

## Allowed raw jj

| Command | Use |
|---|---|
| `jj workspace list` | see open workspaces and stale state |
| `jj workspace update-stale` | refresh a draft after a landing |
| `jj workspace forget "draft-<handle>"` | drop a **landed** draft's workspace |
| `jj rebase -r <dependent> -A <prereq>` (trunk only) | restack a topology inversion; the checker prints the command |
| `jj new <target>` (trunk only) | move `@` to an empty round-tip change |
| `jj restore --from <eval> --to @ -- <gate-paths>` (refine/judge draft) | add the frozen gate test for running; not landable |
| `jj restore --from <draft> --to @ -- <draft-paths>` (judge candidate) | copy the candidate into a clean judge draft |
| `jj status`, `jj diff`, `jj show`, `jj file show`, `jj log` | read and snapshot |
| `scripts/set-round-tip.sh` | after the last landing, put `@` above the highest landed node change |
| `scripts/abandon-empty-heads.sh [--force-stray] [--force-superseded]` | the only abandon path: verified stray heads |

## Forbidden

- `jj new -A` — reparents every child and makes open drafts stale. `deccy new` owns it.
- `jj squash`, `jj split`, `jj metaedit`, `jj undo`, `jj op` — graph surgery.
  `deccy record`/`remove`/`undo` own it.
- `jj abandon` — except through `scripts/abandon-empty-heads.sh`; never run it directly.
- `jj workspace add` — `deccy draft` owns workspace creation, the record and the base.
- `jj describe` — except the summary-only orchestrator exception below. It never changes node
  content or edges.
- `jj new` inside a draft workspace — it creates a child change; the draft is the workspace's `@`.
- Hand-editing `.deccy/work/*.json` — the CLI is the only registry writer.
- `deccy new`/`record`/`remove` from a draft workspace — only the orchestrator runs them, from the
  trunk. `deccy draft`/`drafts`/`discard` work from a linked workspace, but `record --from` and
  `discard` are trunk operations.
- Renames in a draft — `jj diff --summary` reports a rename as one `{old => new}` field, and the
  landing path set becomes ambiguous. Use add + delete.
- Workspaces inside the repository (including `deccy/workspaces/`) — the trunk working copy sees
  their files, and jj reports paths like `.deccy/...` instead of `f.txt`.

## Orchestrator-only exceptions

The orchestrator, and only the orchestrator, may use these:

- `jj rebase -r <dependent> -A <prereq>` — restack a topology inversion reported by
  `check-topology.py`. Use the command the checker prints, re-run the checker until clean, and never
  use it to force a fork or touch a frozen gate; change ids survive the move.
- `jj describe -m "<summary>" <id>` — change a landed node's summary after a landing. Summary only,
  never content or edges, and never before the content is judged and landed.
- `scripts/set-round-tip.sh` — after the last landing, start an empty change above the node change
  that no other node change descends from. `jj new <target>` alone can leave a gate sibling.
- `scripts/abandon-empty-heads.sh --force-stray --force-superseded` — after a landing, abandon a
  head whose every changed path is a byte-identical restore of content an existing node owns (its
  document or a path its `content.ref` lists), or a conflicted copy of existing node documents
  (`--force-superseded`; a conflicted tree can never be recorded). The script still refuses the
  working copy, open workspaces, bookmarked or described heads, node changes, and any other
  non-empty diff. Direct `jj abandon` remains forbidden.
- `jj workspace forget` — only for a **landed** draft whose record `deccy drafts` shows `landed`.
  An open draft is ended with `deccy discard`, not forgotten.

## Recovery

- **Session died:** `deccy drafts`; the record and workspace survive. `cd` into the workspace,
  `jj status`, `jj workspace update-stale`, continue.
- **Draft no longer needed:** `deccy discard <handle>` from the trunk. If it is already landed,
  `jj workspace forget "draft-<handle>"` and run the cleanup scripts.
- **Lost track of a draft:** `deccy drafts` lists handle, state, workspace name and path. A
  `drifted` open record has no jj workspace; discard it and re-open.
- **Trunk moved unexpectedly:** stop; the round barrier was violated. Update-stale every open draft,
  inspect the diff, and re-plan rather than restoring a stale tree.
