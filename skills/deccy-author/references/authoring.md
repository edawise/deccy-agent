# Authoring a decision in an implementation draft

The drafter edits **one decision** in one draft workspace. The gate is already written, recorded
and frozen; the implementation exists to satisfy it. This file covers the mechanics.

## The workspace and the base

### New unit

The workspace is a jj working copy whose `@` is a child of the frozen gate evaluation. That means:

- the gate test/criteria and the prerequisite are in `@-`;
- your edits are in `@`;
- `jj diff --summary -r @` is exactly what the orchestrator will land.

If the gate path is not present in `@-`, the workspace is based at the wrong change: stop.

The decision skeleton may be an ancestor of the gate or a sibling, depending on creation order:
`deccy new` positions at the unique head of `--on`, so the gate can land above the decision. Do not
assume the skeleton is present in the workspace, and do not assume you may edit it if it is. Read
the current document with `deccy show <id>` and write the full decision document in the draft;
your diff relative to the gate is what gets landed.

### Refine unit

The workspace is based at the **existing target**. That means:

- the target’s current node and refs are in `@-`;
- the orchestrator restored the gate paths into `@` so you can run the gate;
- those gate paths may appear in `jj diff --summary -r @`; they are expected, not yours, and are
  **not landable**.

Your landable set is the draft diff minus `$GATE_PATHS`. It must contain only the target node file
and the target’s ref files. Edit the existing node in place; keep `depends_on`/`evaluates` unchanged
unless the orchestrator explicitly included a structure change. If the change needs a different
commitment, a new edge, or a new node, stop: it is a `new` unit, not a refine.

## The decision document

For a **new** unit, write `nodes/<decision-id>.json`. For a **refine**, edit the existing document
in place; keep its `depends_on` and `evaluates` unless the orchestrator explicitly included a
structure change.

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
- `content.rationale` says why this decision is right. Write it **after** the implementation.
- `depends_on` names the prerequisites by change id. Do not add an edge to the gate evaluation;
  the gate is coverage, not a decision prerequisite.

Custody (I6): the only node file you may change is the target decision’s. A ref file belongs to
the node whose `ref` lists it. If you need to change a file owned by another node, stop: that is a
different decision, not a ride.

## New files and paths

- Add new implementation files under the paths the planner assigned to this decision. For a new
  unit, the skeleton is still a placeholder; write the full node with `content.ref` naming the
  planned paths. For a refine, the target’s current `ref` is the base. If a path is new to the
  target’s current `ref`, the orchestrator lands the node JSON first (updating the ref list), then
  the new path; do not smuggle a new path into a one-call record. If the path was not planned, stop
  and re-plan.
- List every new file in `content.ref` before landing. An unref’d file is a decision with no
  content and `deccy record` will not have an owner for it.
- Do not rename files in a draft. `jj diff --summary` reports a rename as one field and the
  landing path set becomes ambiguous. Use add + delete if a rename is unavoidable, and tell the
  orchestrator.
- Do not edit paths in `$GATE_PATHS` (the evaluation node and its tests/criteria). For a new unit,
  if `jj diff --summary -r @` names one, stop. For a refine, the gate paths are expected in the
  draft for running but must be subtracted from the landable set; never edit them.

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
decision may need its own round rather than a rationale that rationalises the code.

## Stop rules

- **No gate, or gate not frozen** — stop.
- **Gate path appears in the landable set** — stop; you are editing or landing the gate. For a
  refine, gate paths in the raw diff are expected; subtract them.
- **A path belongs to another node** — stop; custody.
- **The implementation needs an unsettled prerequisite** — stop; queue it for the next round; do
  not encode a guess.
- **The gate is wrong/ungrounded** — stop; report gate-defect. The grant of authority is the gate,
  not your belief about the feature.
- **The draft would need a new dependency edge, or the refine is really a new decision** — stop;
  the round brief did not cover it.

## Report

```text
draft: <handle>
mode: new | refine
workspace: <absolute path>
target: <change id>
gate: <evaluation change id> hash: <hash>
changed paths: <path>...
landable paths: <path>...          # refine: changed paths minus gate paths
gate command: <command>
gate output: <quoted output>
base red: <quoted failure, if run>
residual risks: <...>
```

The orchestrator lands the draft. You do not run `deccy record`, and you do not claim the round is
done.
