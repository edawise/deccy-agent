# deccy graph workflow

> **Version.** This reference is written for **deccy-cli v0.2.2**, which adds `new --evaluates`,
> the `draft` / `drafts` / `discard` verbs, and the `record --from <handle>` source form. Check
> `deccy --version` before a round. In v0.2.2 `deccy validate` checks validity, resolution and I4
> coverage only; topological order and content custody still need the read-only scripts below.

> **Round note.** Only the orchestrator runs the graph-mutating verbs: `new`, `record`, `remove`,
> `undo` and `redo`. It also opens drafts with `draft` and ends them with `discard`/`record
> --from`. Gate authors and drafters edit files in the draft workspace they are handed and never
> run those verbs. The judge may run `draft` / `drafts` / `discard` for its own clean-room drafts,
> but never `record`. The round protocol in `deccy-round` sequences all of it.

The graph lives in the working copy: one change = one node. Node work and draft workspaces both
go through the `deccy` CLI. Raw `jj` is limited to refresh, restack and verified cleanup.

## The two working-copy surfaces

`deccy` uses `jj` underneath, but you never do change surgery by hand. Two CLI surfaces matter:

- **The trunk working copy (`@`).** `deccy new` makes the new node's change `@`; `deccy record`
  moves edits out of `@` and into an older node's change. Touching `@` directly is only for moving
  an empty round-tip change and for the landing forms below.
- **Draft workspaces.** `deccy draft <node>` creates a jj workspace outside the repository with its
  own `@` (a child of the named node's change), plus one record at `.deccy/work/<handle>.json`.
  Authors edit files there. `deccy record --from <handle> --to <node>` lands the draft; `deccy
  discard <handle>` ends it without landing.

The draft registry is untracked work state, not graph state: `.deccy/work/` is not a node, and a
draft is not a change in the decision stack until it lands.

## Requirements

- `deccy` **0.2.2** or newer on `PATH`; `jj` and `git` too.
- The repository is initialised once with `deccy init <path>`; it creates `.jj`, `nodes/` and
  `.deccy/`. Run it before `jj git init`, not after: without `.deccy/`, marker writes fail.

## Create a node

### A decision

```sh
id=$(deccy new -m "<summary>" --on <dep-id> --on <dep-id>)
# deccy prints the new id, opens its change as @, and writes nodes/<id>.json
$EDITOR nodes/$id.json          # replace the <placeholder> content and rationale
```

`deccy new`:

- requires one `-m <summary>` and at least one `--on <id>`. **`--on` takes one id per flag** —
  repeat it for several dependencies (`--on a --on b`); `--on a b` reads `b` as an unnamed
  argument and refuses;
- refuses any `--on` id that does not resolve, before creating anything;
- positions the new change after the **unique head** of the `--on` set, and refuses a set with more
  than one head (a forked set) — keep the dependencies on one line;
- writes a **decision** skeleton: `kind: decision`, `type: text`, `ref: inline`, a `<placeholder>`
  body and rationale, and `depends_on` listing exactly the `--on` ids. A decision born this way
  carries no `evaluates` key at all.

Fill the placeholders in place. The change summary is fixed at `new` time; to change it later,
`jj describe -m "<summary>" <id>` is the one raw-jj exception (the CLI has no re-describe verb).

### An evaluation (the `--evaluates` flag)

`--evaluates` is the other optional, repeatable argument of `new`. The invocation alone makes the
node an evaluation:

```sh
dec=$(deccy new -m "<decision>" --on <dep-id> --on <dep-id>)
eval=$(deccy new -m "gate: <decision>" --on <dep-id> --on <dep-id> --evaluates "$dec")
```

- `--on` is still required (I2). The evaluation depends on the **standards** the decision takes as
  given, never on the decision it evaluates.
- Each `--evaluates` id must already name a node document. An unknown id refuses the whole
  invocation before anything is created; the root `zzzzzzzz` is unknown here even though `--on`
  admits it.
- The born document is `kind: evaluation`, `evaluates` exactly the named ids (a repeated id once),
  `depends_on` exactly the `--on` ids, and the same text/placeholder content as a decision
  skeleton. The gate author replaces the content and rationale; it does not re-type `kind` or
  `evaluates`.
- With the decision's own `--on` set, `deccy new` inserts the evaluation **between the
  prerequisites and the decision**. That is the birth order, not the final one: the topology
  checker wants an evaluation to follow its subject, so a round restacks the evaluation after the
  decision before implementation. Before the restack the evaluation is an ancestor of the decision
  and its draft does not carry the unbuilt decision; after the restack the evaluation is a child of
  the decision and an implementation draft restores the frozen gate paths for running only.
- For a **refine** whose gate is new or amended: `--evaluates <existing-target-id>` and
  `--on <new-prereq>` (or the old standard set). The evaluation lands between the prerequisite
  and the target.

## Edit an existing node

```sh
# edit the node file and/or its ref'd content in the working copy ...
$EDITOR nodes/<id>.json
$EDITOR <ref-path>
# ... then place those edits into the node's change:
deccy record nodes/<id>.json <ref-path>... --to <id>
```

`deccy record <path>... --to <id>` moves the named working-copy edits into `<id>`'s change. It
refuses (placing nothing) when:

- `--to` is missing, no path is named, or an argument is unnamed;
- an id names neither a valid node nor the root, or names a node with no existing change (the root
  `zzzzzzzz` names no change and refuses the same way);
- a named path is not a working-copy edit, or is not owned by the target (not its node file and not
  one of its `ref` paths).

Success writes nothing to stdout. Ownership is enforced at the door.

### Edit an existing node via a buffer change

When other work is in flight and `@` is some other node, isolate the edit in a disposable buffer
branched at the node, then place it:

```sh
jj new <id>                    # 1. buffer change branched at <id>; @ becomes the buffer
$EDITOR nodes/<id>.json
$EDITOR <ref-path>
deccy record nodes/<id>.json <ref-path>... --to <id>   # 2. place the edits into <id>
```

One buffer per node; place promptly. A new or amended gate should use a **draft** (below) rather
than hand-rolled buffers.

## Draft workspaces (`draft`, `drafts`, `discard`, `record --from`)

A draft is an isolated jj workspace plus a record. The record is the CLI's work state:

```json
{
  "handle": "<generated>",
  "state": "open",
  "node": "<change id>",
  "edit": "<change id>",
  "workspace": { "name": "draft-<handle>", "path": "<absolute path>" },
  "base": { "<owned path>": "<content identity>" }
}
```

`base` is one content identity per path of the node's owned set (its node file and `ref` paths) at
the node's change. It is the staleness baseline. `.deccy/work/` sits in the trunk, untracked, and
is the repository's one registry whichever workspace a call runs in.

### Open

```sh
deccy draft <node>... [--edit <change-id>]
# prints one line per named node: <handle> <workspace path>
```

- The workspace's `@` is a **new child of the named node's change**, so the node's content and all
  its ancestors are in the tree. The draft is that `@`; edit it in place.
- A node named twice opens two drafts (alternatives). Drafts count, nodes do not.
- `--edit` names the one edit the draft belongs to; omitted, it is the invoking change. In a round,
  move `@` to an empty round-tip change first and let the default name it. The record's edit is
  metadata for grouping drafts; it is not the landing purpose.
- The workspace name is `draft-<handle>`; the path is under the per-user root
  `~/.local/share/deccy/workspaces/<repository-namespace>/<handle>`, outside the repository. Do not
  move it: the CLI derives it from `$HOME`, and the guards allow that root.
- Opening writes no graph state and no marker. `deccy undo` does not undo a draft opening;
  `deccy discard` is how a draft is ended.
- Refuse conditions: no node named, an unnamed argument, a node that does not load, or an owned
  `ref` path missing at the node's change.

### List

```sh
deccy drafts
# <handle> <open|landed> <workspace-name> <workspace-path> [drifted]
```

It lists every record, reads the registry and jj only, and changes nothing. `drifted` marks an
**open** record whose named workspace jj no longer lists; a landed record is not drift. A drift is
a stop: discard or re-open the draft rather than editing a directory jj has forgotten.

### Land

```sh
deccy record --from <handle> --to <node> [<path>...]
```

Run it from the trunk. It is a graph write and a recording: it squashes the draft's working-copy
change into the node's change.

- `--to` must be the record's node. An absent handle, an already-landed record, another node's
  record, or a missing workspace refuses.
- The **landable set** is the target node's current owned set (its document plus every `ref` path)
  unioned with the `ref` paths the draft's node document adds. The draft's content for each path is
  compared with the content at the target change; only differing paths land. A ref path the draft
  adds is landable in the **same** call: the node document and the new file land together, and undo
  removes the added path.
- A carried deletion lands; an untouched file does not.
- The landing **refuses when any open record naming the node is stale**, naming each handle and its
  differing paths. A stale draft is discarded and re-opened from the current node; never forced.
- Optional `[path]...` arguments must state the changed landable set **exactly** (every named path
  changed, every changed path named). They are an assertion, not a partial landing.
- The squash is non-interactive and keeps the destination's summary
  (`--use-destination-message`); the node's description is unchanged.
- Success is silent and turns the record `landed`. The draft workspace's `@` is left as an empty
  change. `deccy discard` refuses a landed record, so the orchestrator forgets the workspace with
  `jj workspace forget "draft-<handle>"` and the close-out cleanup abandons the empty head.

### Discard

```sh
deccy discard <handle>...
```

Run it from the trunk. It ends each named **open** draft without landing it: abandon the
workspace's change, forget the jj workspace, remove the draft directory, remove the record. A
handle that names no open record refuses the whole call, naming the handles, before any draft is
touched. A repeated handle names the same draft once.

Use it for rejected candidates, losing alternatives and judge drafts. It writes no node, no change
and no marker, so it is not an undo unit.

### Refreshing after a record

A record rewrites every change above its target, so every other open workspace may become stale:

```sh
cd "$WS"
jj workspace update-stale
jj status
jj diff --summary -r @
```

Re-run the frozen gate after the refresh. A conflict means the draft was built on a base that no
longer exists: discard it and open a fresh draft from the current node.

## Remove a node

```sh
deccy remove <id>
```

Removes the node only when nothing depends on it: it refuses, naming every dependant, while any
node's `depends_on` or a gate's `evaluates` still reaches it. It takes the node's own gates
(evaluations that evaluate only it) with it. A successful removal writes nothing.

## Read and check

```sh
deccy log                    # every node: <id> <kind> <summary>
deccy show <id>...           # a node's stored document as pretty JSON
deccy validate               # validity, resolution and I4 coverage; silent when clean
deccy drafts                 # every draft record with its state and workspace
```

For v0.2.2, `deccy validate` prints one `<check> <id> <reason>` line per failure (`validity`,
`resolution`, `coverage`) and changes nothing. It does **not** check topological order or content
custody; use the read-only scripts for those:

```sh
CORE="<deccy-core skill base directory>"
python3 "$CORE/scripts/check-topology.py" [repo-root]    # every prerequisite precedes its dependent
python3 "$CORE/scripts/check-ref-custody.py" [repo-root] # no change touches another node's content
```

`<deccy-core skill base directory>` is the installed deccy-core skill directory:
`~/.config/opencode/skills/deccy-core` for OpenCode, `~/.claude/skills/deccy-core` for Claude
Code, `~/.agents/skills/deccy-core` for Codex, `~/.pi/agent/skills/deccy-core` for Pi, or
`<project>/.claude/skills/deccy-core` / `<project>/.opencode/skills/deccy-core` /
`<project>/.agents/skills/deccy-core` / `<project>/.pi/skills/deccy-core` when linked
per-project.

Run the custody script **only when no draft is open** (`deccy drafts` shows no `open` row): a draft
by design edits files outside the target's eventual ownership.

Both are diagnostics: they read `jj` history and report. The dependency story the graph records
lives in its edges, and `deccy new --on` positions new nodes correctly by construction. If
`check-topology.py` reports an inversion, fix it with `jj rebase -s <prereq> -B <dependent>` and
re-run the checker.

## Recover

```sh
deccy undo                   # step back over the last operation's pre-boundary
deccy redo                   # step forward over the next undone operation's post-boundary
```

`undo`/`redo` restore whole operation boundaries — a `new`, a `record` (including a `record
--from` landing), a `remove` — tracked across invocations in `.deccy/markers.json`. Draft opening,
listing and discarding write no graph marker and are not undo units. `deccy undo` is the first
resort for a mistaken graph write. For orientation you may still read `jj` directly (read-only):
`jj log`, `jj st`, `jj diff`, `jj show`.

## Rules

- Never fix an old decision with a new change: record the edit into the old node (I1).
- One node at a time: record edits into the node they belong to before starting the next.
- A new node is placed after its dependencies by `deccy new --on`; keep the `--on` set on one line
  (a forked set refuses).
- An evaluation is born with `--evaluates`; do not hand-edit `kind`/`evaluates` on a skeleton.
- A draft is authored in its own workspace and landed with `record --from`; do not hand-roll the
  squash, restore or registry.
- Keep the stack topologically sorted: after adding or rewiring any `depends_on` edge, check that
  every prerequisite precedes its dependent, and restack with `jj rebase -s <prereq> -B
  <dependent>` if it does not (change ids survive the move, so edges are untouched).
- `deccy drafts` is the draft oracle; `jj workspace list` is the workspace oracle. They must agree
  except for a `drifted` row, which is a stop.
