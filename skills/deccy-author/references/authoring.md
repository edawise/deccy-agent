# Authoring a decision in an implementation draft

The drafter edits **one decision** in one draft workspace opened by `deccy draft`. The gate is
already written, recorded and frozen; the implementation exists to satisfy it. This file covers the
mechanics.

## The workspace and the base

### New unit

The orchestrator opened the draft with `deccy draft <decision-id>`. The workspace's `@` is a child
of the decision, and the skeleton pass's evaluation was restacked to follow the decision. That
means:

- the decision skeleton and its prerequisites are ancestors, present in the tree;
- the frozen gate paths are **not** ancestors; the orchestrator restored them into `@` for running;
- your edits are in `@`;
- `jj diff --summary -r @` contains the restored gate paths plus your work; the landable set is
  that diff minus the gate paths.

If the gate path is not present, the orchestrator's restore did not happen: stop and report it.

### Refine unit

The orchestrator opened the draft with `deccy draft <target-id>`. The workspace is based at the
**existing target**, so:

- the target's current node and refs are in `@-`;
- a newly added gate evaluation is a child after the topology restack (an amended existing one is
  normally an ancestor), so the orchestrator restored the frozen gate paths into `@` for running;
- those restored gate paths appear in `jj diff --summary -r @`; they are expected, not yours, and
  are **not landable**.

Your landable set is the draft diff minus `$GATE_PATHS`. It must contain only the target node file
and the target's ref files. Edit the existing node in place; keep `evaluates` unchanged and keep
`depends_on` unchanged except for the edge the plan names. A new edge needs a covering evaluation
(I4), which the orchestrator freezes before your draft opens. If the change needs a different
commitment or a new node, stop: it is a `new` unit, not a refine.

## The decision document

For a **new** unit, write `nodes/<decision-id>.json`. For a **refine**, edit the existing document
in place; keep its `evaluates` and keep `depends_on` except for the edge the plan names.

```json
{
  "kind": "decision",
  "content": {
    "type": "text",
    "ref": "inline",
    "rationale": "...",
    "content": "..."
  },
  "depends_on": ["<prerequisite-change-id>"]
}
```

- `kind` stays `decision`; decisions never carry `evaluates`.
- `content.type` names the form: `text`, `ears`, `visual-spec`, `json-schema`, and so on.
- `content.ref` is `"inline"` with `content.content`, or a list of repo-relative paths carrying
  the content. If you implement files, list them in `ref`; otherwise they are undocumented.
- When `ref` is a list, **omit `content.content`**. The body is in the files; the schema rejects a
  body alongside a ref list. Keep `content.type`, `content.ref` and `content.rationale`.
- `content.rationale` says why this decision is right. Write it **after** the implementation.
- `depends_on` names the prerequisites by change id. Do not add the gate evaluation itself to
  `depends_on`; the gate is coverage, not a decision prerequisite.

Custody (I6): the only node file you may change is the target decision’s. A ref file belongs to
the node whose `ref` lists it. If you need to change a file owned by another node, stop: that is a
different decision, not a ride.

## New files and paths

- Add new implementation files under the paths the planner assigned to this decision. For a new
  unit, write the full node with `content.ref` naming the planned paths. For a refine, the target's
  current `ref` is the base. A path new to the target's current `ref` is fine: `deccy record --from`
  lands the node JSON and the new path in one recording (the CLI unions the target's owned set with
  the refs the draft's node document adds). If the path was not planned, stop and re-plan.
- List every new file in `content.ref` before landing. An unref'd file is a decision with no
  content and the landing has no owner for it.
- Do not rename files in a draft. `jj diff --summary` reports a rename as one field and the
  landing path set becomes ambiguous. Use add + delete if a rename is unavoidable, and tell the
  orchestrator.
- Do not edit paths in `$GATE_PATHS` (the evaluation node and its tests/criteria). A restored gate
  path is expected in the draft for running (new unit and refine alike) but must be subtracted from
  the landable set; never edit it.

## Running the gate

The orchestrator gives you the exact command. Run it from the workspace root. Capture the command
and the output. The gate author already ran it red on the base — the prerequisite for a new unit,
the target’s current state for a refine; you run it green on the candidate. If the orchestrator
asked for a confirming red run before you edit, run it and quote the failure.

- **Green** means the frozen gate passes. It does not mean the command exited zero for an unrelated
  reason; inspect the output.
- If the gate fails, fix the implementation. Do not edit, weaken, skip or special-case the gate.
- If the gate passes before you implement, stop: the gate is already satisfied or not testing the
  decision. Report it; the gate author owns the fix.

## Alternatives

If you are one of several alternatives, your handle names one approach. Implement it completely
and independently. Do not read the other workspace, copy its files, or coordinate. The judge
compares candidates; the user chooses. A smaller, well-gated alternative is better than a merged
compromise that neither draft can explain.

## Prose and rationale

The decision’s rationale is the last thing you write. It states what the code now does and why the
choice is right. If the implementation changed the intended decision, stop and say so; the
decision may need its own layer rather than a rationale that rationalises the code.

## Stop rules

- **No gate, or gate not frozen** — stop.
- **Gate path appears in the landable set** — stop; you are editing or landing the gate. For a
  refine, gate paths in the raw diff are expected; subtract them.
- **A path belongs to another node** — stop; custody.
- **The implementation needs an unsettled prerequisite** — stop; queue it for the next layer; do
  not encode a guess.
- **The gate is wrong/ungrounded** — stop; report gate-defect. The grant of authority is the gate,
  not your belief about the feature.
- **The draft would need a dependency edge the plan did not name, or the refine is really a new
  decision** — stop; the layer plan did not cover it.

## Report

```text
draft: <handle>
mode: new | refine
workspace: <absolute path>
target: <change id>
gate: <evaluation change id> hash: <hash>
changed paths: <path>...
landable paths: <path>...          # changed paths minus gate paths (both modes)
gate command: <command>
gate output: <quoted output>
base red: <quoted failure, if run>
residual risks: <...>
```

The orchestrator lands the draft with `deccy record --from <handle> --to <target>`. You do not run
`deccy record`, `deccy draft` or `deccy discard`, and you do not claim the round is done.
