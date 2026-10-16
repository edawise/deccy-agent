# deccy graph workflow

The graph lives in the working copy: one change = one node. All node work goes through the
`deccy` CLI, which drives the version-control layer for you. Use these exact workflows.

## The working-copy model

`deccy` uses `jj` underneath, but you never do change surgery by hand. The facts that matter:

- **`deccy new` makes the new node's change the working copy (`@`).** The skeleton it writes is
  already in that change, so edits you make now land in the node you just created.
- **`deccy record` moves edits out of `@` and into an older node's change.** Use it whenever the
  thing you are editing is not `@`'s own node.
- By default there is no separate scratch change: while `@` is a node's change, every file you
  touch lands in that node, so touch only files that node owns. When you must edit a node without
  disturbing whatever `@` currently holds, open a **buffer** change first (`jj new <id>`, below).

## Create a node

```sh
id=$(deccy new -m "<summary>" --on <dep-id> --on <dep-id>)
# deccy prints the new id, opens its change as @, and writes nodes/<id>.json
# fill the node in place:
$EDITOR nodes/$id.json          # replace the <placeholder> content and rationale
# add or modify its ref'd files too
```

`deccy new`:

- requires one `-m <summary>` (the node's description, naming the decision) and at least one
  `--on <id>` (its dependencies). **`--on` takes one id per flag** — repeat it for several
  dependencies (`--on a --on b`); `--on a b` reads `b` as an unnamed argument and refuses;
- refuses any `--on` id that does not resolve, before creating anything;
- positions the new change after the **unique head** of the `--on` set, and refuses a set with more
  than one head (a forked set) — keep the dependencies on one line;
- writes a **decision** skeleton: `kind: decision`, `type: text`, `ref: inline`, a `<placeholder>`
  body and rationale, and `depends_on` listing exactly the `--on` ids.

Fill the placeholders in place. To make an **evaluation** node, edit the skeleton's `kind` to
`evaluation`, add `evaluates` (the node(s) it checks), and set `depends_on` to the prerequisite(s)
the use is checked against — see the sandwich rule (I4) in the skill.

The change summary is fixed at `new` time. To change it later, `jj describe -m "<summary>" <id>` is
the one raw-jj exception (the CLI has no re-describe verb).

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

Success writes nothing to stdout. Because the ownership check is part of `record`, an edit that
belongs to a different node simply will not place — custody is enforced at the door.

## Edit an existing node via a buffer change (jj squash)

When other work is in flight and the working copy is some other node, isolate the edit in a
disposable buffer branched at the node, then place it:

```sh
jj new <id>                    # 1. buffer change branched at <id>; @ becomes the buffer
# 2. make the edits to the node's file and/or its ref'd content ...
$EDITOR nodes/<id>.json
$EDITOR <ref-path>
deccy record nodes/<id>.json <ref-path>... --to <id>   # 3. place the edits into <id>
```

`deccy record` folds the buffer's edits into `<id>`'s change — the same `jj squash --into <id>` the
CLI runs internally; the buffer, now empty, is abandoned and a fresh working copy is left on top.
This is the classic scratch-change + squash shape, with the CLI doing the squash:

- one buffer per node — never edit two nodes' files in one buffer;
- place promptly — a buffer left sitting collects descendants and confuses the next person;
- `deccy undo` (or `jj undo`) walks it back if a place lands wrong.

Edit directly in the working copy and `record` (the section above) when `@` is free to hold the
edit; open a buffer when `@` is another node you must not disturb.

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
deccy validate               # validity, resolution, and I4 coverage; silent when clean
```

`deccy validate` prints one `<check> <id> <reason>` line per failure (`validity`, `resolution`,
`coverage`) and changes nothing. It does not check topological order or content custody; use the
read-only scripts for those:

```sh
scripts/check-topology.py    # every prerequisite precedes its dependent
scripts/check-ref-custody.py # no change touches another node's content
```

Both are diagnostics: they read `jj` history and report. The dependency story the graph records
lives in its edges, and `deccy new --on` positions new nodes correctly by construction. If
`check-topology.py` reports an inversion, fix it with `jj rebase -s <prereq> -B <dependent>` and
re-check.

## Recover

```sh
deccy undo                   # step back over the last operation's pre-boundary
deccy redo                   # step forward over the next undone operation's post-boundary
```

`undo`/`redo` restore whole operation boundaries (a `new`, a `record`, a `remove`), tracked across
invocations in `.deccy/markers.json`. `deccy undo` is the first resort for any mistake. For
orientation you may still read `jj` directly (read-only): `jj log`, `jj st`, `jj diff`, `jj show`.

## Rules

- Never fix an old decision with a new change: record the edit into the old node (I1).
- One node at a time: record edits into the node they belong to before starting the next.
- A new node is placed after its dependencies by `deccy new --on`; keep the `--on` set on one line
  (a forked set refuses).
- Keep the stack topologically sorted: after adding or rewiring any `depends_on` edge, check that
  every prerequisite precedes its dependent, and restack with `jj rebase -s <prereq> -B
  <dependent>` if it does not (change ids survive the move, so edges are untouched).
