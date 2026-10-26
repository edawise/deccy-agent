# Round protocol: commands and failure handling

This is the executable version of the round. Run it from the repository root. The orchestrator is
the only agent that mutates the graph; everyone else edits files in a workspace and reports.

## 0. Names and state

```sh
ROUND="r$(date +%Y%m%d-%H%M%S)"
ROOT="$HOME/.local/share/deccy/agent"
STATE="$ROOT/rounds/$ROUND/ROUND.md"
mkdir -p "$ROOT/rounds/$ROUND" "$ROOT/workspaces/drafts/$ROUND" "$ROOT/workspaces/judge/$ROUND"
```

`ROUND.md` is the prototype registry. It is **not** in the graph. Keep it current while the round is
open; it is live work state, not audit, and is deleted at close (see 7.1):

```markdown
# Round <id>
base: <change id>
cap: 5
barrier: refuse
## Units
| unit | mode | target | base | gate | hash | state |
## Drafts
| handle | mode | workspace | target | draft change | paths | state |
## Verdicts
| draft | base-red | candidate-green | verdict | notes |
## Choice
```

Count **round units from the brief** against `max_open_units` (default 5; `0` unlimited). Gate
drafts — including an amended gate for a refine — and implementation drafts belong to their unit.
An alternative is another draft of the same unit, not another unit, until it is forgotten.

## 1. Approve the brief

1. The planner returns the brief from `round-brief.md`. The orchestrator checks it against the
   graph.
2. Check the cap: the brief names at most `max_open_units` units unless the user raised it.
3. Check for open drafts from an earlier round:

   ```sh
   jj workspace list
   ```

   If any are open and the barrier is `refuse`, stop: resume or close them first. `warn` reports
   and asks; `off` proceeds only with the user's explicit approval.
4. Check the base: `deccy validate`; `jj status`. The round starts from a clean working copy.
5. Ask the user to approve the brief, the cap and the gate forms.

## 2. Create the skeletons (before any workspace)

Create nodes in dependency order. `deccy new` uses `jj new -A` at the unique head of `--on`, so
this must happen while no draft is open. It refuses a `--on` set with more than one head; keep
each prerequisite line contiguous, or split the round. The final `--after` removes this
limitation.

```sh
id=$(deccy new -m "<summary>" --on <dep-id> --on <dep-id>)
```

Create **skeletons only**, with `deccy new`. Do not edit the skeleton in the trunk: the orchestrator
does not write node content or structure. Record the planned refs from the brief in `ROUND.md`; the
role author writes the full node document (including `content.ref`) in its draft. At landing, if a
path is a new `ref`, record the node JSON first, then the new path (see 3.3 and 6).

```sh
deccy new -m "gate: <what it checks>" --on <prerequisite-id>
# the skeleton is a decision with a placeholder; the gate author changes it to kind=evaluation,
# adds evaluates/depends_on/content.ref in the gate draft.
```

Record every id and the planned ref paths in `ROUND.md`. Do not open a gate or implementation
workspace yet.

**Refine units do not create a skeleton.** For a unit with mode `refine <existing id>`:

- record the target id, its current `ref` paths and its current `depends_on` set;
- record the gate evaluation id and whether the gate is **reused** or **amended**;
- do not run `deccy new` for the target and do not create a second decision node.

If the refine needs a different commitment, a new `depends_on` edge, or a new node, stop and plan
a `new` unit instead.

## 3. Gate drafts: author, red, land, freeze

Gate drafts are **serial** in the prototype. Parallel gate drafts go stale as soon as the first
gate is recorded.

### 3.0 Reuse or amend a refine gate

A **new** unit normally needs a new gate. A **refine** unit may reuse its existing evaluation or
amend it.

**Reuse.** Read the existing `$EVAL_ID`, confirm it still covers the use, then compute
`$GATE_PATHS`/`$GATE_HASH` with the commands in 3.4 (skip the recording step; the gate already
exists). Do not open a gate draft. If the reused gate already passes on the target’s current state
and the refine is meant to change behavior, the gate is not red for that change: amend it or report
that the change is already satisfied.

**Amend.** Open a gate draft at the existing evaluation, exactly as 3.1. The gate author edits the
evaluation document and its tests and reports. If the evaluation branch does not include the
existing target, the orchestrator also opens a **check workspace** at the target and restores the
new test paths into it; the gate author only runs the red command there:

```sh
CHECK="$ROOT/workspaces/drafts/$ROUND/gate-check-<handle>"
jj workspace add "$CHECK" --name "deccy-$ROUND-gate-check-<handle>" -r "$TARGET_ID"
cd "$CHECK"
printf '%s\n' "$NEW_GATE_PATHS" | xargs -r jj restore --from "$GATE_DRAFT" --to @ --
# hand $CHECK to the gate author; it runs <red command> there and does not edit the target
```

`$NEW_GATE_PATHS` is the test/criteria path set reported by the gate author, excluding
`nodes/<EVAL_ID>.json`. The check workspace is for evidence only: the gate author must not edit the
target, and the orchestrator forgets it after the red run. Land the gate draft into the evaluation
with 3.3, freeze with 3.4, then continue.

### 3.1 Open

```sh
WS="$ROOT/workspaces/drafts/$ROUND/gate-<handle>"
NAME="deccy-$ROUND-gate-<handle>"
jj workspace add "$WS" --name "$NAME" -r "$EVAL_ID"
```

The workspace’s `@` is a child of the evaluation node; `@-` includes the prerequisite and either
the new skeleton or the existing evaluation being amended. Edit in place.

### 3.2 Author and red

The gate author writes:

- `nodes/<EVAL_ID>.json`: `kind: evaluation`, `evaluates`, `depends_on`, `content.type`,
  `content.ref` and `content.rationale`;
- the test/criteria files listed in `content.ref`.

Then run the red command from inside the workspace. For a **new** gate, run it against the
prerequisite without the implementation. For an **amended** gate, run it against the existing
target’s current state (see 3.0 for the check workspace):

```sh
cd "$WS"
<red command>
```

It must fail for the reason the gate names. Capture the command and the failure output in the
gate report. A test that passes before the implementation is already satisfied or not testing the
decision: stop and fix the gate, unless it is an intentionally weak review criterion (for example a
licence-only gate with no runnable red); then report it as weak and let the user accept the
advisory.

### 3.3 Land

```sh
# inside the draft workspace, after the author reports
cd "$WS"
jj status                                  # snapshot
jj diff --summary -r @                     # inspect; no renames, no gate-free source edits
DRAFT=$(jj log -r @ --no-graph -T 'change_id.shortest(8)')
PATHS=$(jj diff --summary -r @ | sed -n 's/^[A-Z] //p')
# Prototype path rule: no spaces in draft paths; the xargs landing splits on whitespace.

# in the trunk
cd <repo-root>
jj new "$EVAL_ID"                          # landing buffer, child of the evaluation
printf '%s\n' "$PATHS" | xargs -r jj restore --from "$DRAFT" --to @ --
# if any path is a new ref, two-step:
#   deccy record nodes/<EVAL_ID>.json --to "$EVAL_ID"
#   printf '%s\n' "$NEW_PATHS" | xargs -r deccy record --to "$EVAL_ID"
# otherwise, one call:
printf '%s\n' "$PATHS" | xargs -r deccy record --to "$EVAL_ID"
jj workspace forget "$NAME"                # removes the workspace; check heads for a leftover
jj new "$EVAL_ID"                          # return the working copy to the tip
```

`workspace forget` does not reliably remove a forgotten working-copy commit. After all drafts are
forgotten, the close-out cleanup in §6.1 abandons the empty stray heads; never run `jj abandon`
directly.

`deccy record` refuses a path that is not changed in the trunk working copy or not owned by the
evaluation. Do not work around a refusal with `jj squash`; inspect the paths and the evaluation’s
`ref`, fix the draft, and retry.

**New ref paths.** Ownership is checked against the target’s current document. If a draft adds a
path that is not yet in the target’s `ref`, the one-call record refuses it. The draft’s node JSON
must list the new path in `content.ref`; record the node file first
(`deccy record nodes/<target>.json --to <target>`), which updates the ref list, then record the new
path. If the path was not planned, stop and re-plan; do not smuggle it in.

### 3.4 Freeze the gate

After recording a new/amended gate (or for a reused gate, immediately), read the evaluation’s refs
— including unchanged existing tests — and hash the evaluation document plus every ref path at the
evaluation revision:

```sh
GATE_PATHS=$(jj file show -r "$EVAL_ID" "nodes/$EVAL_ID.json" \
  | jq -r 'if (.content.ref | type) == "array" then .content.ref[] else empty end')
# If jq is unavailable, use the gate author's reported ref paths instead.
GATE_HASH=$(
  { jj file show -r "$EVAL_ID" "nodes/$EVAL_ID.json"
    printf '%s\n' "$GATE_PATHS" | while IFS= read -r p; do
      [ -n "$p" ] && jj file show -r "$EVAL_ID" "$p"
    done
  } | shasum -a 256 | awk '{print $1}'
)
```

Store `$GATE_HASH` and `$GATE_PATHS` in `ROUND.md`. The implementation draft receives them. The
judge recomputes the hash after applying the gate; a mismatch is a **gate-integrity** failure. For
an amended gate, this hash replaces the old one; any verdict based on the old hash is void.

## 4. Implementation drafts: parallel, at the frozen gate

### 4.1 New unit

For a new decision with one gate, base the draft at the gate evaluation so the test is already in
the tree:

```sh
WS="$ROOT/workspaces/drafts/$ROUND/impl-<handle>"
NAME="deccy-$ROUND-impl-<handle>"
jj workspace add "$WS" --name "$NAME" -r "$EVAL_ID"
```

The workspace’s `@` is a child of the evaluation; `@-` contains the gate test and the prerequisite.
The drafter writes:

- `nodes/<DECISION_ID>.json` (the full document; the skeleton may be an ancestor or a sibling
  depending on creation order, so do not rely on editing an existing copy);
- the decision’s `ref` files (implementation);
- nothing else.

Do not edit any path in `$GATE_PATHS`. Run the frozen gate:

```sh
cd "$WS"
<green command>
```

Capture the command and output. Reject your own work if the gate fails; do not edit the gate.

### 4.2 Refine unit

For a refine, base the draft at the **existing target**, not at the evaluation, so it carries the
target’s current node and refs:

```sh
WS="$ROOT/workspaces/drafts/$ROUND/refine-<handle>"
NAME="deccy-$ROUND-refine-<handle>"
jj workspace add "$WS" --name "$NAME" -r "$TARGET_ID"
cd "$WS"
printf '%s\n' "$GATE_PATHS" | xargs -r jj restore --from "$EVAL_ID" --to @ --
```

The gate paths are now in the workspace **for running only**. They are expected to appear in
`jj diff --summary -r @` if they are not already in the target’s tree; they are not part of the
refine and must not be landed. The drafter edits the target’s node JSON and its own ref files,
runs the gate, and reports:

```sh
cd "$WS"
jj status
DRAFT=$(jj log -r @ --no-graph -T 'change_id.shortest(8)')
PATHS=$(jj diff --summary -r @ | sed -n 's/^[A-Z] //p')
LANDABLE_PATHS=$(printf '%s\n' "$PATHS" | grep -vxF -f <(printf '%s\n' "$GATE_PATHS" | sed '/^$/d') || true)
# uses bash/zsh process substitution; run in bash or zsh
```

`LANDABLE_PATHS` becomes the refine `DRAFT_PATHS` used by the judge and the landing. It must
contain only the target node file and the target’s current or planned `ref` files. A gate path in
`LANDABLE_PATHS` is a gate-integrity failure; a path outside the target’s refs is a custody defect.

### 4.3 Packet

Before handing either draft to the judge, snapshot it and record the packet:

```sh
cd "$WS"
jj status
DRAFT=$(jj log -r @ --no-graph -T 'change_id.shortest(8)')
PATHS=$(jj diff --summary -r @ | sed -n 's/^[A-Z] //p')
# new unit: DRAFT_PATHS = PATHS; it must be disjoint from GATE_PATHS.
# refine:   DRAFT_PATHS = LANDABLE_PATHS (PATHS minus GATE_PATHS).
```

The judge needs `DRAFT`, `DRAFT_PATHS`, `DECISION_ID`/`TARGET_ID`, `EVAL_ID`, `GATE_HASH` and
`GATE_PATHS`.

For an alternative pair, open two workspaces from the same base — `$EVAL_ID` for a new unit,
`$TARGET_ID` for a refine — with handles `alt-a` and `alt-b`. They do not see each other. The user
chooses after judging.

## 5. Judge drafts before recording

The judge uses **two clean workspaces at the decision node**, not the drafter’s workspace.

It reports three things: a **candidate verdict** (`accept` / `reject` / `inconclusive`), **gate
integrity** (`intact` / `broken`), and **gate strength** (`sound` / `weak`). `gate-integrity` blocks:
the evidence cannot be trusted. `gate-weak` is **advisory**: the candidate may still be accepted,
and the orchestrator asks the user whether to accept the weak gate or return it to the gate author.
The judge never vetoes a candidate on weakness.

```sh
JROOT="$ROOT/workspaces/judge/$ROUND/<handle>"
jj workspace add "$JROOT/base" --name "deccy-$ROUND-<handle>-base" -r "$DECISION_ID"
jj workspace add "$JROOT/cand" --name "deccy-$ROUND-<handle>-cand" -r "$DECISION_ID"
```

Both workspaces’ `@` are children of the decision node. The candidate is `@-` in each.

### 5.1 Base-red

```sh
cd "$JROOT/base"
printf '%s\n' "$GATE_PATHS" | xargs -r jj restore --from "$EVAL_ID" --to @ --
<red command>                              # should fail for the gate's reason
```

A **pass** is not a candidate rejection: record `gate strength: weak` (no base-red) and continue.
A crash from a broken harness or unrelated fixture is `inconclusive`; report exactly what is broken.

### 5.2 Candidate-green

```sh
cd "$JROOT/cand"
printf '%s\n' "$GATE_PATHS" | xargs -r jj restore --from "$EVAL_ID" --to @ --
printf '%s\n' "$DRAFT_PATHS" | xargs -r jj restore --from "$DRAFT" --to @ --
jj diff --summary -r @                     # test paths must be the gate's, not new edits
<green command>                            # must pass
```

Before running, check that `$DRAFT_PATHS` contains no path in `$GATE_PATHS`; if it does, the draft
edited the gate: **gate integrity: broken** and `reject`. For a refine, `$DRAFT_PATHS` is the
landable set only; the gate paths in the drafter’s workspace are expected and are not candidate
edits. Recompute `$GATE_HASH` from the restored gate paths; a mismatch is **gate integrity:
broken**.

The judge may add counterexamples, mutation checks or a second run, but it must not edit the
candidate or the graph. If a plausible wrong candidate passes, record `gate strength: weak` with
the counterexample; do not reject the candidate on that basis. Clean up:

```sh
jj workspace forget "deccy-$ROUND-<handle>-base"
jj workspace forget "deccy-$ROUND-<handle>-cand"
```

Record the base-red output, candidate-green output, gate integrity, gate strength, extra checks and
verdict in `ROUND.md`. A `gate-weak` advisory is recorded even when the candidate is accepted.

## 6. User choice and landing

The user chooses one alternative. Before landing, confirm the current draft change id and paths
match the judge’s packet; if the drafter touched the draft after judging, the verdict is stale and
the draft must be rejudged. If the judge reports `gate strength: weak`, surface the advisory
explicitly and ask the user whether to accept the weak gate or return it to the gate author. Do not
land a weak-gated candidate without that choice; record the advisory in `ROUND.md` either way. Then
land exactly that draft:

```sh
cd "$WS"
jj status
DRAFT=$(jj log -r @ --no-graph -T 'change_id.shortest(8)')
# DRAFT_PATHS is the judge packet: full diff for a new unit, landable set for a refine.
# Confirm DRAFT and DRAFT_PATHS still match the judge's packet before landing.

cd <repo-root>
jj new "$TARGET_ID"
printf '%s\n' "$DRAFT_PATHS" | xargs -r jj restore --from "$DRAFT" --to @ --
printf '%s\n' "$DRAFT_PATHS" | xargs -r deccy record --to "$TARGET_ID"
jj workspace forget "$NAME"
jj new "$TARGET_ID"
```

`$TARGET_ID` is the new decision for a `new` unit and the existing decision for a `refine` unit.
Land exactly the judged paths. For a refine, never restore or record `$GATE_PATHS`; they belong to
the evaluation. If a landable path is a new `ref` for the target, record
`nodes/<target>.json` first (it updates the ref list), then record the new path. If the draft
changed after judging, the verdict is stale: rejudge or reject. After the record, re-read the
target and compare the landed paths to the draft; the gate hash must still match. A mismatch means
the record or a rebase changed the candidate — stop and report. Forget every losing alternative
with `jj workspace forget`.

For a unit with no alternative, the same sequence records the single judged draft.

### 6.1 Clean up stray heads

`jj workspace forget` removes the workspace, not necessarily its working-copy commit. A draft
forgotten while it still carried content can survive as a head. A refine or judge workspace also
leaves a head when its only diff is a gate path restored for review, such as
`nodes/<eval>.json`. Confirm `jj workspace list` is `default` only first — an open judge or draft
workspace keeps its `@` as a legitimate head and the cleanup refuses it. After returning the
working copy to the round tip, run the verified cleanup:

```sh
~/.config/opencode/skills/deccy-round/scripts/abandon-empty-heads.sh --dry-run
~/.config/opencode/skills/deccy-round/scripts/abandon-empty-heads.sh --force-stray
jj log -r 'heads(all())'
```

The script abandons heads that are empty, undescribed, unbookmarked, not an open workspace's
working copy, and not a node's own change (`nodes/<id>.json`). With `--force-stray`, it also
abandons a head whose every changed path is a byte-identical restore of an existing node document
— the gate-path-only head a review-criteria refine can leave. It refuses any other non-empty
diff. It exits nonzero if any other head remains. Never run `jj abandon` directly.
A nonzero exit is a stop: report the remaining head and ask, rather than forcing a one-line history.

## 7. Close

```sh
CORE="<deccy-core skill base directory>"
deccy validate
python3 "$CORE/scripts/check-topology.py"
python3 "$CORE/scripts/check-ref-custody.py"
jj workspace list
jj log -r 'heads(all())'      # exactly one head: the working copy
# recompute every GATE_HASH from the evaluation and its ref paths
# a mismatch is gate-integrity: stop, do not report the round as closed
```

`check-ref-custody.py` is only meaningful when no draft workspaces are open. Report:

- the node ids created or edited, and their gates;
- each draft, its judge verdict, and the user’s choice;
- every path landed and every path dropped;
- every deviation from the brief, with why;
- residual risks (especially the prototype’s gates-after-decisions history, reused refine gates,
  and new refs landed in two records).

The round is complete when the user approves the recorded result, not when the scripts pass.

### 7.1 Delete the ledger

After the user approves the close report, delete the round ledger:

```sh
~/.config/opencode/skills/deccy-round/scripts/delete-round-state.sh "$ROUND"
```

`ROUND.md` is live work state, not audit: the close report is the durable record. The script removes
`rounds/$ROUND/ROUND.md` and the empty round directory; it refuses a missing or malformed round id,
a path outside `rounds/`, and a symlinked round directory. It never deletes a workspace, a node, or
anything outside the round's own directory. A nonzero exit is a stop: report it and ask.

## 8. Failure handling

| Symptom | Action |
|---|---|
| `jj workspace list` shows `stale` | `cd "$WS" && jj workspace update-stale`; re-check `jj diff`; if it conflicts with the new base, abort the draft and re-open it from the current gate. |
| `deccy record` refuses a path | Inspect `jj diff --summary -r @` and the target’s `ref`/node file. If it is a new ref, record the node file first, then the ref path; if it is unplanned, stop and re-plan. Never `jj squash` by hand. |
| Draft has a rename | Discard the rename; use add + delete, or defer to the final CLI. `jj diff --summary` reports renames as one field and the landing path set becomes ambiguous. |
| Judge says reject | Open a fresh `rev2` draft from the same gate; keep the rejected draft until the round closes for evidence, then forget it. Do not edit the gate to fit. |
| Judge reports gate-weak | Advisory, not a stop. Record the evidence and ask the user whether to accept the weak gate or return it to the gate author. The candidate may stand. If the user returns it, the gate author amends; the old hash and verdict are void; re-freeze and re-judge. |
| Judge reports gate-integrity | Stop the unit. The gate author reopens a gate draft; the old hash and verdict are void. Re-record the gate, re-freeze, re-open implementation drafts. |
| Refine landable set contains a gate path | The draft edited the gate or the path subtraction failed. Stop; restore the gate path from `$EVAL_ID`, re-snapshot, and re-judge. Never land a gate path into the target. |
| Refine needs a new edge or a different decision | Stop. That is a `new` unit (or a structure round), not a refine; do not fold it into the target. |
| Reused refine gate already passes on the target | The gate is not red for the change. Report `gate-weak`; the user decides whether the change is already satisfied or the gate must be amended first. |
| `heads(all())` has a stray head after `workspace forget` | Run `scripts/abandon-empty-heads.sh`; it abandons verified empty, undescribed, unbookmarked, non-open-workspace, non-node heads. If the head is a gate-path-only restore, run it with `--force-stray`, which requires every changed path to be a byte-identical restore of an existing node document. If it exits nonzero, stop and report the remaining head. Never `jj abandon` directly. |
| `heads(all())` has a non-empty head or more than one head after cleanup | Stop. The round produced a fork or left a real head; do not abandon a non-empty change or rebase. Report it and ask. |
| Session died | `jj workspace list`; `cd` into the workspace; `jj status`; resume. The workspace and draft change survive. |
| User changes scope mid-round | Stop; close or park open drafts; re-plan the round. Do not add a sixth unit under a five-unit cap. |
