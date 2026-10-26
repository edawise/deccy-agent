# jj-direct draft workspaces

The prototype uses jj workspaces for isolation, but jj never writes the graph. `deccy new` and
`deccy record` remain the only graph writers. This file records the exact raw-jj surface and the
traps found while prototyping on jj 0.45.1.

## The model

```text
trunk @  (or a landing buffer)
   |
   +-- decision node D
   |      |
   |      +-- gate evaluation E   (child of the prerequisite, evaluates D)
   |
   +-- draft workspace @          (child of E for an implementation draft)
```

A workspace created with `jj workspace add -r <base>` gets a **new working-copy commit** whose
parent is `<base>`. That working-copy commit is the draft. It is not a child of the trunk’s `@`
unless `<base>` is the trunk tip; it is a normal commit in the same repository.

The draft’s changed paths are the diff of the workspace’s `@` against its parent(s):

```sh
cd "$WS"
jj diff --summary -r @
```

## Allowed in the prototype

| Command | Use |
|---|---|
| `jj workspace add <path> --name <name> -r <base>` | open a draft |
| `jj workspace list` | see open drafts and stale state |
| `jj workspace forget <name>` | drop a draft; check for an empty leftover head |
| `scripts/abandon-empty-heads.sh [--force-stray]` | the only abandon path: verified stray heads; `--force-stray` also accepts a head whose every changed path is a byte-identical restore of an existing node document |
| `jj workspace update-stale` | refresh a workspace after the trunk moved |
| `jj status` | snapshot the draft and show changes |
| `jj diff --summary -r @` | list the draft’s changed paths |
| `jj log -r @ --no-graph -T 'change_id.shortest(8)'` | read the draft change id |
| `jj show`, `jj file show` | read content |
| `jj new <target>` (trunk only) | create a landing buffer child of the target |
| `jj restore --from <draft> --to @ -- <paths>` (trunk only) | copy the draft’s content into the buffer |
| `jj restore --from <eval> --to @ -- <gate-paths>` (refine draft) | add the frozen gate test for running; not landable |

## Forbidden in the prototype

- `jj new -A` — reparents every child and makes open workspaces stale. `deccy new` owns it.
- `jj squash`, `jj rebase`, `jj split`, `jj metaedit`, `jj undo`, `jj op` — graph surgery.
  `deccy record`/`remove`/`undo` own it.
- `jj describe` — except the summary-only orchestrator exception below. It never changes node
  content or edges.
- `jj abandon` — except through `scripts/abandon-empty-heads.sh`; never run `jj abandon`
  directly.

## Orchestrator-only exceptions

The orchestrator, and only the orchestrator, may use these two:

- `jj describe -m "<summary>" <id>` — change a landed node's summary after a landing. This is
  the one raw-jj exception recorded in `deccy-core/references/cli.md`: summary only, never
  content or edges, and never before the content is judged and landed.
- `scripts/abandon-empty-heads.sh --force-stray` — after a landing, abandon a head whose every
  changed path is a byte-identical restore of an existing node document (a gate path restored
  for review, or a similar draft artifact). The script still refuses the working copy, open
  workspaces, bookmarked or described heads, node changes, and any non-restore diff. Direct
  `jj abandon` remains forbidden.
- `jj restore` without `--from <draft> --to @` — it can wipe the working copy.
- `jj new` inside a draft workspace — it creates a child change; the draft is the workspace’s
  `@`, and adding a child changes what “the draft” means.
- `deccy new`/`record`/`remove` from a draft workspace — only the orchestrator runs them, from the
  trunk.
- Renames in a draft — `jj diff --summary` reports a rename as one `{old => new}` field, and the
  landing path set becomes ambiguous. Use add + delete.
- Paths with spaces in a draft — the prototype’s `xargs` landing splits on whitespace. Keep draft
  paths simple; the final CLI will handle arbitrary paths.
- Workspaces inside the repository (including `.deccy/workspaces/`) — the trunk working copy sees
  their files, and jj reports paths like `.deccy/workspaces/.../f.txt` instead of `f.txt`.

## Workspace location and paths

Use a root outside the repo:

```sh
ROOT="$HOME/.local/share/deccy/agent"
WS="$ROOT/workspaces/drafts/$ROUND/$HANDLE"
```

Run jj **from inside the workspace**:

```sh
cd "$WS"
jj status
jj diff --summary -r @
```

Running `jj -R "$WS"` from the trunk can resolve to the trunk repository and report
non-repo-relative paths (`../.../f.txt`). `cd` is the reliable form.

The workspace’s tracked paths are relative to its own root, which is also the repository’s path
set for the files it carries. A file at `<repo>/src/foo.ts` appears as `src/foo.ts` from inside
the workspace and in `jj diff -r <draft-change>` from the trunk.

## Stale workspaces

`deccy init` sets `snapshot.auto-update-stale=false`. After any trunk mutation (recording a gate,
recording the chosen implementation), every other open workspace may be stale:

```sh
cd "$WS"
jj workspace update-stale
jj status
```

If the update reports a conflict against the new base, the draft was built on a base that no
longer exists. Do not resolve it by hand: forget the workspace and re-open a fresh draft from the
current gate. This is the prototype’s stand-in for the final `record --from` base check.

## Refine drafts

A refine edits an existing target, so base the workspace at the **target**, not at the gate:

```sh
jj workspace add "$WS" --name "$NAME" -r "$TARGET_ID"
cd "$WS"
printf '%s\n' "$GATE_PATHS" | xargs -r jj restore --from "$EVAL_ID" --to @ --
```

The target’s current node and refs are in `@-`; the gate test is restored into `@` for running
only. `jj diff --summary -r @` will therefore include the gate paths (if they were not already in
the target tree). They are **not landable**:

```sh
PATHS=$(jj diff --summary -r @ | sed -n 's/^[A-Z] //p')
LANDABLE_PATHS=$(printf '%s\n' "$PATHS" | grep -vxF -f <(printf '%s\n' "$GATE_PATHS" | sed '/^$/d') || true)
```

The subtraction uses bash/zsh process substitution; run it in bash or zsh, not a POSIX-only shell.

Land only `LANDABLE_PATHS`; the gate paths stay in the evaluation. A gate path in the landable set
means the draft edited the gate (or the subtraction failed): stop and re-judge. A path outside the
target’s `ref` is a custody violation.

## Landing

The landing buffer is a new child of the target node in the trunk. For a refine, `PATHS` here means
the landable set from the section above:

```sh
jj new "$TARGET"
printf '%s\n' "$PATHS" | xargs -r jj restore --from "$DRAFT" --to @ --
printf '%s\n' "$PATHS" | xargs -r deccy record --to "$TARGET"
jj workspace forget "$NAME"
jj new "$TARGET"
```

`deccy record` runs `jj squash --into <target>` internally, so the graph write stays in the CLI.
`jj workspace forget` removes the workspace, but not reliably its working-copy commit: a draft
forgotten while it still carried content can survive as an empty head. After all drafts are
forgotten, run `scripts/abandon-empty-heads.sh`; it abandons only verified empty, undescribed,
unbookmarked, non-open-workspace, non-node heads and requires exactly one head afterwards. Do not run `jj abandon` directly.
If the draft has descendants (it should not), forget leaves them behind — another reason not to run
`jj new` inside a draft.

**New refs.** `deccy record` checks ownership against the target’s **current** document. A draft
that adds a new file must either have it already in the target’s current `ref` or land in two
records: the node file first, then the new path. The node-file record updates `ref`; the second
record is then owned. Do not use `jj squash` to bypass the refusal.

## Recovery

- **Session died:** `jj workspace list`; the workspace and draft change survive. `cd` in,
  `jj status`, continue.
- **Draft no longer needed:** `jj workspace forget <name>`, then run
  `scripts/abandon-empty-heads.sh` (never `jj abandon` directly), then remove the directory.
- **Lost track of a draft:** `jj workspace list`; `cd <path> && jj log -r @`; the name encodes the
  round and handle.
- **Trunk moved unexpectedly:** stop; the round barrier was violated. Update-stale every open
  workspace, inspect the diff, and re-plan rather than restoring a stale tree.
