# Round protocol: layer plan, skeleton pass, parallel components

This is the executable version of the round. Run it from the repository root. The orchestrator is
the only agent that mutates the graph; everyone else edits files in a draft workspace and reports.

The draft lifecycle is **deccy-cli v0.2.2**: the orchestrator opens drafts with `deccy draft`, lands
them with `deccy record --from`, and ends unlanded drafts with `deccy discard`. Raw `jj` remains only
for refresh (`workspace update-stale`), restack (`rebase`), workspace listing/forgetting, and the
verified cleanup scripts. Check `deccy --version` before the round; a version below 0.2.2 stops it.

## 0. Names and state

```sh
ROUND="r$(date +%Y%m%d-%H%M%S)"
ROOT="${DECCY_AGENT_ROOT:-$HOME/.local/share/deccy/agent}"
STATE="$ROOT/rounds/$ROUND/ROUND.md"
MAP="$ROOT/rounds/$ROUND/map.tsv"
mkdir -p "$ROOT/rounds/$ROUND"
```

`ROUND.md` is the prototype ledger. It is **not** in the graph and is **not** the draft registry:
`deccy drafts` is the authoritative draft list. The ledger records the layer plan, the handle map,
the component partition, gate hashes, verdicts and the user's choices. It is live work state, not
audit, and is deleted at close (see 9.1). It covers the whole layer, including every component:

```markdown
# Round <id> — layer <name>
base: <change id>
round edit: <change id>
barrier: refuse
max_units_per_layer: 12
max_open_drafts: 6
## Layer plan
| # | act | decision | on (takes as given) | gate | writes | fork | elaborates |
## Skeleton map
| handle | kind | change id | component |
## Components
| component | units | state |
## Drafts
| component | unit | handle | mode | workspace | target | state |
## Verdicts
| draft | base-red | candidate-green | verdict | notes |
## Choices
| unit | alternatives offered | user choice | weak-gate decision |
```

The **handle map** is the only link between the plan's local handles and change ids. Write a row
when `deccy new` prints an id; never guess one. `map.tsv` is `handle<TAB>change-id`, one per line.
Draft handles come from `deccy draft` and are recorded in `ROUND.md`; `deccy drafts` lists them at
any time.

## 1. Approve the layer plan

1. The planner returns a layer plan from `references/layer-plan.md`. The orchestrator checks it
   against the graph (see 2).
2. Check the size: `max_units_per_layer` defaults to 12 (`0` unlimited). Above it, split the layer;
   do not raise the bound to fit one plan.
3. Check for open drafts and workspaces:

   ```sh
   deccy drafts          # every open draft; no open row is the clean base
   jj workspace list
   ```

   If any draft or workspace is open and the barrier is `refuse`, stop: resume or close it first.
   `warn` reports and asks; `off` proceeds only with the user's explicit approval.
4. Check the base: `deccy validate`; `jj status`; `jj log -r 'heads(all())'`. The round starts from
   a clean, single-headed working copy with `@` empty.
5. Ask the user to approve the layer plan and every fork. Gate forms are not approved here: the
   gate author derives them from the evaluation matrix, and weak gates are surfaced at judge time.

## 2. Check the plan

Before creating anything:

1. Handles are unique; every `on` resolves to a recorded id or an earlier handle; no cycles.
2. Every `new` row has at least one `on` (I2) and `gate: new` (or a named existing evaluation that
   covers every edge the row adds).
3. Every `refine` target exists, appears once, and is not created by this plan.
4. A `refine` that adds an edge names `gate: amend <id>` or `gate: new` (or `reuse <id>` only when
   the existing evaluation already covers the edge), and the new prerequisite is already an
   ancestor of the target.
5. Every row elaborates a recorded clause or an earlier plan row; that citation is not an edge.
6. No row depends on an unchosen fork. If one does, remove the dependants from this layer (they
   belong to the next one); do not create their skeletons provisionally.
7. Every row carries a `writes` set, and two rows share a path only along an `on` chain.
8. Every recorded id named in `on` is an ancestor of the base tip; otherwise the skeleton pass could
   fork. Check each one with `jj log -r '<id>::@' --no-graph -T 'change_id.shortest(8)'`; an empty
   result means it is not an ancestor.
9. The layer is not larger than `max_units_per_layer`.

A failed check stops the round. Do not repair a plan by inventing a node, an edge or a gate.

## 3. Skeleton pass (all nodes before any workspace)

`deccy new` uses `jj new -A` at the unique head of its `--on` set. Creating a skeleton therefore
reparents history and makes every open draft stale, so **all** skeletons are created here, before
the first draft. Because the pass appends in one line, every `--on` set has a unique head and
cannot fork.

Create the decision, then its evaluation with the **same** `--on` set and `--evaluates`:

```sh
DEC=$(deccy new -m "<decision summary>" --on "$on1" --on "$on2")
EVAL=$(deccy new -m "gate: <decision>" --on "$on1" --on "$on2" --evaluates "$DEC")
```

`--evaluates` does the work that used to be a manual edit:

- the born node is `kind: evaluation`, with `evaluates: ["$DEC"]` exactly;
- `depends_on` is exactly the `--on` set (the standards), never the decision it evaluates;
- `deccy new` inserts the evaluation between the prerequisites and the decision. At birth the
  evaluation is an ancestor of the decision, so a gate draft does not carry the unbuilt decision.
  The topology checker wants the opposite order (an evaluation follows its subject), so 5.5
  restacks the evaluation after the decision before implementation; an implementation draft then
  restores the frozen gate paths for running only;
- the evaluation id must already name a node document. The decision was just created, so this is
  the correct order.

Resolve handles through `map.tsv` before calling `deccy new`:

```sh
resolve() {
  hit=$(awk -F '\t' -v h="$1" '$1==h{print $2}' "$MAP")
  printf '%s\n' "${hit:-$1}"
}
on1=$(resolve U1)
on2=$(resolve <recorded-id>)
DEC=$(deccy new -m "<decision>" --on "$on1" --on "$on2")
printf '%s\t%s\n' U2 "$DEC" >> "$MAP"
EVAL=$(deccy new -m "gate: <decision>" --on "$on1" --on "$on2" --evaluates "$DEC")
printf '%s\t%s\n' "G-U2" "$EVAL" >> "$MAP"
```

For each `new` row, in dependency order:

1. Resolve its `on` handles to change ids through `map.tsv`; leave recorded ids as they are.
2. `deccy new -m "<decision>" --on ...`; record `handle<TAB>id` in `map.tsv`.
3. If `gate: new`, create the evaluation immediately with the same `--on` set and
   `--evaluates "$DEC"`. Record `G-<handle><TAB>id`.
4. If `gate: new` is not used, the existing evaluation named by `reuse`/`amend` already covers the
   edges; no skeleton is created.

For a `refine <existing id>` row, create no decision skeleton. Record the target id under its
handle, its current `ref` paths, its current `depends_on` set, and whether its gate is `reuse`d,
`amend`ed, or `new`. A refine with `gate: new` creates its evaluation in this pass:

```sh
EVAL=$(deccy new -m "gate: refine <target>" --on <new-prereq> --evaluates "$TARGET")
```

The `--on` set is the new standard (plus any other standard the check applies); `--evaluates` is
the existing target. The evaluation lands between the prerequisite and the target at birth; 5.5
restacks it after the target before implementation, and the refine draft restores the gate paths
for running only.

Do not edit a skeleton in the trunk. The role authors write the full node document in their drafts.
At landing, `record --from` handles a new `ref` path in the same call as the node JSON (see 5.3).

**After the last skeleton**, move `@` above the round tip so `deccy draft`'s default edit is the
round's empty change, not a node:

```sh
<deccy-round-skill-dir>/scripts/set-round-tip.sh
ROUND_EDIT=$(jj log -r @ --no-graph -T 'change_id')
```

Pass `--edit "$ROUND_EDIT"` to every `deccy draft` for the rest of the round. The edit is the one
edit the draft belongs to; it is not the landing target and must never be a node id.

**Do not open a draft until every skeleton for the layer exists.** After this phase the trunk is
not touched again except by gate and implementation landings.

`deccy validate` is expected to be unhappy during this phase: placeholders and not-yet-authored
evaluation skeletons leave coverage holes. Validate after every landing and at close, not
immediately after the pass.

## 4. Partition into components

Build the graph induced by the planned units: an edge `U -> V` when `U`'s `on` names `V`'s handle.
Recorded prerequisites do not create edges; they are already landed and connect nothing.

Each **weakly connected component** is one track. Units inside a component run in dependency order.
Components run in parallel: they share no plan edge, so a landing in one cannot change another's
prerequisite semantics.

A shared write path is not a component edge; it is a plan error. Check 2 already requires two rows
that share a path to sit on one `on` chain. If you find a shared path across components, stop and
re-plan: do not invent an order between them.

Write the partition into the ledger. If the partition produces one giant component (everything
chains through one unit), that is a planning result, not a failure: it serialises, and the planner
should be asked whether the chain can be cut in the next layer.

## 5. Gate drafts: author parallel, record serial

Gate drafts may be authored concurrently across components because each bases at its own evaluation
node. Inside a component, author them in dependency order: a unit's gate needs its prerequisites'
landed content. Gates must be **landed** one at a time: a landing rewrites every change above the
target, so every other open draft needs a refresh afterwards.

### 5.0 Reuse, amend or add a refine gate

A **new** unit has a new evaluation. A **refine** unit may reuse its existing evaluation, amend it,
or add a new evaluation for an edge it adds.

**Reuse.** Read the existing `$EVAL_ID`, confirm it still covers every edge the refine uses
(including any edge the refine adds; a new edge is covered only if the evaluation already depends
on that prerequisite), then compute `$GATE_PATHS`/`$GATE_HASH` with 5.4 (skip the drafting step).
Do not open a gate draft. If the reused gate already passes on the target's current state and the
refine is meant to change behavior, the gate is not red for that change: amend it or report that
the change is already satisfied.

**Amend.** Open a gate draft at the existing evaluation. Extend its `depends_on` to include the new
prerequisite and its check to cover the new addition. The evaluation is an ancestor of the target,
so a refine draft of the target already carries the existing test; the **new or changed** test paths
are still in the gate draft, not in the target. After the author has written the gate and
reported its changed test/criteria paths, the orchestrator also opens a **check draft** at the
target, restores those paths into it, and hands it to the gate author for the red run only:

```sh
read -r CHECK_HANDLE CHECK_WS <<EOF
$(deccy draft "$TARGET_ID" --edit "$ROUND_EDIT")
EOF
GATE_DRAFT=$(cd "$WS" && jj log -r @ --no-graph -T 'change_id')
# NEW_GATE_PATHS = the gate draft's changed test/criteria paths, reported by the author
(cd "$CHECK_WS" && jj restore --from "$GATE_DRAFT" --to @ -- $NEW_GATE_PATHS)
# hand $CHECK_WS to the gate author; discard it after the red run:
deccy discard "$CHECK_HANDLE"
```

**New evaluation.** A refine that adds an edge may need a separate evaluation instead of amending
the existing one. The skeleton pass created it with `--on <new prereq> --evaluates "$TARGET"`. Open
a gate draft at that evaluation. The evaluation is inserted before the target, but its test is still
in the gate draft, so use the same check-draft rule: restore the new test/criteria paths from the
gate draft into a target check draft and run the red command there.

The check draft is evidence only. `deccy discard` it after the red run. Land the gate draft with
5.3, freeze with 5.4, then continue.

### 5.1 Open

```sh
read -r HANDLE WS <<EOF
$(deccy draft "$EVAL_ID" --edit "$ROUND_EDIT")
EOF
```

`deccy draft` prints exactly one line: `<handle> <workspace path>`. The workspace's `@` is a child
of the evaluation node; `@-` includes the evaluation, its node document, its test/criteria paths, and
the prerequisite. Edit in place. Record `HANDLE` and `WS` in the ledger and hand `WS` to the gate
author.

If the command refuses, stop. Do not create a workspace by hand, and do not reuse a draft handle for
a second target.

### 5.2 Author and red

The gate author writes:

- `nodes/<EVAL_ID>.json`: the content (`content.type`, `content.ref`, `content.rationale`). The
  document is already `kind: evaluation` with `evaluates` and `depends_on` set by `--evaluates`;
  the author does not re-type them;
- the test/criteria files listed in `content.ref`.

The gate author **derives the form** from the evaluation matrix (parent layer × child layer) and
then derives the red command from the form. The plan carries neither. Test and criteria paths stay
inside the unit's `writes` set; a path outside it means the plan is wrong: stop, do not silently
widen the row.

Before running red, refresh the workspace (§6.0); another component's landing may have moved the
base. Then:

```sh
cd "$WS"
<red command>
```

For a **new** gate, the draft's `@` contains the prerequisite and the new test but not the decision,
so the run is red by construction. For an **amended** gate or a **new evaluation for a refine**, run
against the existing target's current state in the check draft (5.0). It must fail for the
reason the gate names; capture the command and failure. A test that passes before the implementation
is already satisfied or not testing the decision: stop and fix the gate, unless it is an
intentionally weak review criterion; then report it as weak and let the user accept the advisory.

### 5.3 Land

```sh
cd <repo-root>
deccy record --from "$HANDLE" --to "$EVAL_ID"
```

`record --from` compares the draft's content with the evaluation's content and lands only the
changed paths of the landable set. A new `ref` path is landable in the **same** call as the node
document; do not split the landing. Run `deccy validate` after it; a schema or resolution failure
stops the unit.

```sh
jj workspace forget "draft-$HANDLE"
# leave the landed record in place; deccy discard refuses a landed draft
```

The landing rewrites every change above the evaluation and refreshes nothing automatically:
**refresh every other open draft (§6.0) before continuing.**

`deccy record --from` refuses a stale draft, naming the handle and the differing paths. That is a
stop, not a puzzle: `deccy discard "$HANDLE"`, re-open a fresh draft from the current evaluation,
and redo the authoring. Never hand-roll `jj squash` or `jj restore` to bypass the refusal.

**New ref paths.** The landable set is the evaluation's current owned set plus the `ref` paths the
draft's node document adds, so one `record --from` lands the node JSON and the new file together.
`deccy undo` removes the added path as part of the same recording. If the path was not planned, stop
and re-plan.

### 5.4 Freeze the gate

After landing a new or amended gate (or for a reused gate, immediately), read the evaluation's refs
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

Store `$GATE_HASH` and `$GATE_PATHS` in the ledger. The implementation draft receives them. The
judge recomputes the hash after applying the gate; a mismatch is a **gate-integrity** failure. For
an amended or newly added refine gate, this hash replaces the old one (or is the first); any
verdict based on an older hash is void.

### 5.5 Restack the gate chain

`deccy new --evaluates` inserts the evaluation **before** its subject, but the topology checker wants
an evaluation to follow what it evaluates. Until the chain is restacked, the checker reports every
evaluation as an inversion. Restack it before opening any implementation draft:

```sh
python3 "$CORE/scripts/check-topology.py"
jj rebase -r <dependent> -A <prereq>      # the command the checker prints
python3 "$CORE/scripts/check-topology.py"
```

Repeat while the checker reports an inversion. It reads nodes from the working-copy tree, so if `@`
is below part of the chain it may report only the inversions it can see. Once it is clean, put `@`
at the round tip and re-check with the full tree:

```sh
<deccy-round-skill-dir>/scripts/set-round-tip.sh
python3 "$CORE/scripts/check-topology.py"
```

If that reports another inversion, restack and repeat. A clean check with `@` at the tip is the gate
for opening implementation drafts. Change ids survive the move, so node filenames and edges are
untouched. This is the one raw-jj history move the orchestrator may make; the checker is the oracle.
If a restack would move a landed decision's content or a frozen gate, stop and report it instead.

## 6. Implementation drafts: parallel, at the frozen gate

### 6.0 Refresh after a landing

Any landing rebases the changes above the target. Before authoring, running a gate, judging or
landing in any open draft, refresh it:

```sh
cd "$WS"
jj workspace update-stale
jj status
jj diff --summary -r @        # must still be the draft you think it is
```

Then re-run the frozen gate. If the gate's result changed, stop: the drafts were not independent, or
the draft was edited after judging. A conflict means the draft is stale; `deccy discard` it and
rebuild from the current gate rather than resolving it by hand.

Check `deccy drafts` too: an `open` row marked `drifted` means its jj workspace is gone. Discard or
re-open it; do not edit a directory jj has forgotten.

### 6.1 New unit

For a new decision with one gate, open the implementation draft at the decision. After 5.5's
restack the evaluation follows the decision, so it is **not** in the draft tree; restore the frozen
gate paths into the draft for running:

```sh
read -r HANDLE WS <<EOF
$(deccy draft "$DECISION_ID" --edit "$ROUND_EDIT")
EOF
cd "$WS"
[ -n "$GATE_PATHS" ] && jj restore --from "$EVAL_ID" --to @ -- $GATE_PATHS
```

The workspace's `@` is a child of the decision; `@-` is the decision skeleton, and its prerequisites
are ancestors. The restored gate paths are for running only and are **not landable**. The drafter
writes:

- `nodes/<DECISION_ID>.json` (the full document; the skeleton is in the tree, but write it in full);
- the decision's `ref` files (implementation);
- nothing else.

Do not edit any path in `$GATE_PATHS`. Run the frozen gate in the draft, with the restored gate
paths present:

```sh
cd "$WS"
<green command>
```

Capture the command and output. Reject your own work if the gate fails; do not edit the gate.

### 6.2 Refine unit

For a refine, open the draft at the **existing target**, so it carries the target's current node and
refs:

```sh
read -r HANDLE WS <<EOF
$(deccy draft "$TARGET_ID" --edit "$ROUND_EDIT")
EOF
```

For an **amended existing** evaluation, the evaluation is an ancestor of the target, so the landed
test is already in the target's tree. For a **new** evaluation, the restack puts it after the
target, so it is not in the draft tree. The orchestrator restores the frozen gate paths from
`$EVAL_ID` uniformly (a no-op when they are already present) for running only:

```sh
cd "$WS"
[ -n "$GATE_PATHS" ] && jj restore --from "$EVAL_ID" --to @ -- $GATE_PATHS
```

Restored gate paths are **for running only**. The landing's landable set is the target's current
owned set plus refs the target node adds; a restored gate path is not in it. The drafter edits the
target's node JSON (including the `depends_on` edge the plan names, if any) and its own ref files,
runs the gate, and reports the changed paths.

The judge's packet is the changed paths minus `$GATE_PATHS`:

```sh
cd "$WS"
jj status
DRAFT=$(jj log -r @ --no-graph -T 'change_id.shortest(8)')
PATHS=$(jj diff --summary -r @ | sed -n 's/^[A-Z] //p')
LANDABLE_PATHS=$(printf '%s\n' "$PATHS" | grep -vxF -f <(printf '%s\n' "$GATE_PATHS" | sed '/^$/d') || true)
# uses bash/zsh process substitution; run in bash or zsh
```

`LANDABLE_PATHS` must contain only the target node file and the target's current or planned `ref`
files. A gate path in `LANDABLE_PATHS` is a gate-integrity failure; a path outside the target's refs
is a custody defect.

### 6.3 Packet

Before handing either draft to the judge, snapshot it and record the packet:

```sh
cd "$WS"
jj status
DRAFT=$(jj log -r @ --no-graph -T 'change_id.shortest(8)')
PATHS=$(jj diff --summary -r @ | sed -n 's/^[A-Z] //p')
# both modes: DRAFT_PATHS = PATHS minus GATE_PATHS. The restored gate paths are for
# running only; the CLI's landable set excludes them and the judge must not apply them.
DRAFT_PATHS=$(printf '%s\n' "$PATHS" | grep -vxF -f <(printf '%s\n' "$GATE_PATHS" | sed '/^$/d') || true)
```

The judge needs the draft **handle**, its workspace path, `DRAFT`, `DRAFT_PATHS`,
`DECISION_ID`/`TARGET_ID`, `EVAL_ID`, `GATE_HASH` and `GATE_PATHS`.

For an alternative pair, open two drafts of the same node with two `deccy draft` calls — `$DECISION_ID`
for a new unit, `$TARGET_ID` for a refine. They do not see each other. The user chooses after
judging. Alternatives do not count against `max_open_drafts` as extra units, but they do count as
open drafts.

## 7. Judge drafts before recording

The judge uses **two clean drafts at the decision node**, not the drafter's workspace. It opens them
itself with `deccy draft` (work-state writes, no graph writes), runs the checks, and ends them with
`deccy discard` before the orchestrator lands. The judge never runs `deccy record`.

It reports three things: a **candidate verdict** (`accept` / `reject` / `inconclusive`), **gate
integrity** (`intact` / `broken`), and **gate strength** (`sound` / `weak`). `gate-integrity` blocks:
the evidence cannot be trusted. `gate-weak` is **advisory**: the candidate may still be accepted,
and the orchestrator asks the user whether to accept the weak gate or return it to the gate author.
The judge never vetoes a candidate on weakness.

```sh
cd <repo-root>
read -r BASE_HANDLE BASE_WS <<EOF
$(deccy draft "$DECISION_ID" --edit "$ROUND_EDIT")
EOF
read -r CAND_HANDLE CAND_WS <<EOF
$(deccy draft "$DECISION_ID" --edit "$ROUND_EDIT")
EOF
```

Both workspaces' `@` are children of the decision node; the candidate is `@-` in each. A new
evaluation follows the decision after 5.5's restack; an amended existing one is normally an
ancestor. Restore the frozen gate paths from `$EVAL_ID` into both drafts uniformly (a no-op when
they are already present). Refresh both (§6.0) before running anything. For a refine, substitute
`$TARGET_ID`; the restore is the same.

### 7.1 Base-red

```sh
cd "$BASE_WS"
jj workspace update-stale
[ -n "$GATE_PATHS" ] && jj restore --from "$EVAL_ID" --to @ -- $GATE_PATHS
<red command>                              # should fail for the gate's reason
```

A **pass** is not a candidate rejection: record `gate strength: weak` (no base-red) and continue.
A crash from a broken harness or unrelated fixture is `inconclusive`; report exactly what is broken.

### 7.2 Candidate-green

```sh
cd "$CAND_WS"
jj workspace update-stale
[ -n "$GATE_PATHS" ] && jj restore --from "$EVAL_ID" --to @ -- $GATE_PATHS
[ -n "$DRAFT_PATHS" ] && jj restore --from "$DRAFT" --to @ -- $DRAFT_PATHS
jj diff --summary -r @                     # test paths must be the gate's, not new edits
<green command>                            # must pass
```

Before running, check that `$DRAFT_PATHS` contains no path in `$GATE_PATHS`; if it does, the draft
edited the gate: **gate integrity: broken** and `reject`. For a refine, `$DRAFT_PATHS` is the
landable set only; the gate paths in the drafter's workspace are expected and are not candidate
edits. Recompute `$GATE_HASH` from the restored gate paths; a mismatch is **gate integrity:
broken**.

The judge may add counterexamples, mutation checks or a second run, but it must not edit the
candidate or the graph. If a plausible wrong candidate passes, record `gate strength: weak` with the
counterexample; do not reject the candidate on that basis. Clean up:

```sh
cd <repo-root>
deccy discard "$BASE_HANDLE" "$CAND_HANDLE"
```

Discard before the landing: an open judge draft names the same node, and a stale one would refuse
the landing. Record the base-red output, candidate-green output, gate integrity, gate strength,
extra checks and verdict in the ledger. A `gate-weak` advisory is recorded even when the candidate
is accepted.

## 8. User choice and landing, per component

When a component's candidates are judged, ask the user to choose one alternative per unit and to
accept or return each weak gate. Before landing, confirm the current draft change id and paths match
the judge's packet; if the drafter touched the draft after judging, the verdict is stale and the
draft must be rejudged. Do not land a weak-gated candidate without the user's choice; record the
advisory in the ledger either way. Then land exactly that draft:

```sh
cd "$WS"
jj status
jj workspace update-stale
DRAFT=$(jj log -r @ --no-graph -T 'change_id.shortest(8)')
# DRAFT_PATHS is the judge packet: full diff for a new unit, landable set for a refine.
# Confirm DRAFT and DRAFT_PATHS still match the judge's packet before landing.

cd <repo-root>
# The CLI snapshots the draft workspace itself. Pass DRAFT_PATHS as the assertion when the
# paths are simple; the landing refuses if the set disagrees.
deccy record --from "$HANDLE" --to "$TARGET_ID" $DRAFT_PATHS
deccy validate
jj workspace forget "draft-$HANDLE"
```

`$TARGET_ID` is the new decision for a `new` unit and the existing decision for a `refine` unit.
The CLI lands exactly the changed landable set; for a new unit or a refine that set never includes a
restored gate path unless the draft actually edited an owned gate file, which is a gate-integrity
failure. If a
landable path is a new `ref` for the target, the same `record --from` lands the node JSON and the
new path; do not split it. A refusal (stale draft, wrong `--to`, no changed path, path-set
disagreement) is a stop: inspect, discard or re-open, and re-judge; never force it.

After the landing, re-read the target and compare the landed paths to the draft; the gate hash must
still match. Then refresh every other open draft (§6.0) and re-run its gate. If a gate result
changes because another component landed, stop: the components were not independent and the plan's
partition was wrong.

`jj workspace forget` removes the workspace but may leave the draft's empty `@` as a head. Run
`set-round-tip.sh` and the verified cleanup (§8.1) after the component's landings.

For a unit with no alternative, the same sequence records the single judged draft. Land a
component's units in dependency order. Components land independently: a finished component does not
wait for the others. Never land a restored gate path for a new unit or a refine.

Discard the losing alternatives and rejected drafts:

```sh
deccy discard "$LOSING_HANDLE"
```

`deccy discard` abandons the draft's change, forgets its workspace, removes its directory, and
removes the record. It refuses a landed record; a landed draft's workspace is cleaned with
`jj workspace forget` plus the cleanup scripts.

### 8.1 Clean up stray heads and landed records

`jj workspace forget` removes the workspace, not necessarily its working-copy commit. A draft
forgotten while it still carried content can survive as a head. A refine or judge draft also
leaves a head when its only diff is a gate path restored for review, such as
`nodes/<eval>.json`. Confirm `deccy drafts` shows no `open` row and `jj workspace list` is `default`
only first — an open judge or draft keeps its `@` as a legitimate head and the cleanup
refuses it.

After every component has landed and every draft workspace is forgotten, move `@` above the round's
highest landed node change:

```sh
<deccy-round-skill-dir>/scripts/set-round-tip.sh
```

The script finds the node change — the change carrying its own `nodes/<id>.json` — that no other
node change descends from, and starts an empty change above it. It refuses a fork of two node
changes; that is a stop, not a cleanup. Then run the verified cleanup:

```sh
<deccy-round-skill-dir>/scripts/abandon-empty-heads.sh --dry-run
<deccy-round-skill-dir>/scripts/abandon-empty-heads.sh --force-stray --force-superseded
jj log -r 'heads(all())'
```

`<deccy-round-skill-dir>` is the installed `deccy-round` skill directory:
`~/.config/opencode/skills/deccy-round` for OpenCode, `~/.claude/skills/deccy-round` for Claude
Code, `~/.agents/skills/deccy-round` for Codex, `~/.pi/agent/skills/deccy-round` for Pi, or
`<project>/.claude/skills/deccy-round` / `<project>/.opencode/skills/deccy-round` /
`<project>/.agents/skills/deccy-round` / `<project>/.pi/skills/deccy-round` when linked
per-project.

The script abandons heads that are empty, undescribed, unbookmarked, not an open workspace's
working-copy commit, and not a node's own change (`nodes/<id>.json`). With `--force-stray`, it also
abandons a head whose every changed path is a byte-identical restore of content owned by an existing
node — its document, or a path its `content.ref` array lists — the gate-path-only head a
review-criteria refine can leave, and the landed draft head a forgotten implementation workspace can
leave. With `--force-superseded`, it further abandons a head whose every changed path is an existing
`nodes/<owner>.json` and which jj reports as conflicted: a conflicted tree can never be recorded, and
that is the shape a judge draft leaves when a candidate goes stale. A clean non-identical copy of
a node document is still refused. It refuses any other non-empty diff. It exits nonzero if any other
head remains. Never run `jj abandon` directly. A nonzero exit is a stop: report the remaining head and
ask, rather than forcing a one-line history.

The `.deccy/work` records of landed drafts are retained by the CLI (v0.2.2 has no prune verb); they
are work history, not graph state. Do not delete them by hand without the user's approval.

## 9. Close

```sh
CORE="<deccy-core skill base directory>"
cd <repo-root>
deccy validate
deccy drafts                  # no `open` row; every landed draft is forgotten in jj
python3 "$CORE/scripts/check-topology.py"
python3 "$CORE/scripts/check-ref-custody.py"
jj workspace list
jj log -r 'heads(all())'      # exactly one head: the working copy
# recompute every GATE_HASH from the evaluation and its ref paths
# a mismatch is gate-integrity: stop, do not report the round as closed
```

`check-ref-custody.py` is only meaningful when no draft is open. Report:

- the layer plan and the component partition that was executed;
- the node ids created or edited, and their gates;
- each draft, its judge verdict, and the user's choice;
- every path landed and every path dropped;
- every deviation from the plan, with why;
- residual risks (the linear skeleton stack, refined gates, new refs landed with the node JSON, and
  any component that had to be serialised).

The round is complete when the user approves the recorded result, not when the scripts pass.

### 9.1 Delete the ledger

After the user approves the close report, delete the round ledger:

```sh
<deccy-round-skill-dir>/scripts/delete-round-state.sh "$ROUND"
```

`ROUND.md` and `map.tsv` are live work state, not audit: the close report is the durable record. The
script removes `rounds/$ROUND/ROUND.md` and `rounds/$ROUND/map.tsv`, then the round directory if it
is empty; it refuses a missing or malformed round id, a path outside `rounds/`, and a symlinked
round directory. It never deletes a workspace, a node, or anything outside the round's own
directory. A nonzero exit is a stop: report it and ask.

## 10. Failure handling

| Symptom | Action |
|---|---|
| `deccy drafts` shows `drifted` | The jj workspace behind an open record is gone. `deccy discard <handle>` and re-open from the current node; do not edit the orphaned directory. |
| `jj workspace list` shows `stale` | `cd "$WS" && jj workspace update-stale`; re-check `jj diff`; if it conflicts with the new base, `deccy discard` the draft and re-open it from the current gate. |
| `deccy record --from` says a draft is stale | Another draft of the same node landed or the node changed. `deccy discard` the stale handle, re-open from the current node, re-author, re-judge. Never force the landing. |
| `deccy record --from` refuses the path set | The optional paths must equal the changed landable set exactly. Re-read `jj diff --summary -r @` and the evaluation/target `ref`; discard and re-judge if the draft changed. |
| `deccy discard` names a handle with no open draft | The record is already landed or the handle is wrong. Check `deccy drafts`; a landed draft is cleaned with `jj workspace forget`, not `discard`. |
| Gate result changes after another component lands | Stop the affected component. The partition was wrong or the draft changed; re-plan rather than forcing independence. |
| `deccy record` refuses a path | Inspect `jj diff --summary -r @` and the target's `ref`/node file. With `record --from`, a new ref is landable in the same call; with the path form, it is not. If it is unplanned, stop and re-plan. Never `jj squash` by hand. |
| Draft has a rename | Discard the rename; use add + delete. `jj diff --summary` reports renames as one field and the landing path set becomes ambiguous. |
| Judge says reject | Open a fresh `rev2` draft from the same gate; keep the rejected draft until the component closes for evidence, then `deccy discard` it. Do not edit the gate to fit. |
| Judge reports gate-weak | Advisory, not a stop. Record the evidence and ask the user whether to accept the weak gate or return it to the gate author. The candidate may stand. If the user returns it, the gate author amends; the old hash and verdict are void; re-freeze and re-judge. |
| Judge reports gate-integrity | Stop the unit. The gate author reopens a gate draft; the old hash and verdict are void. Re-land the gate, re-freeze, re-open implementation drafts. |
| Landable paths contain a gate path | The draft edited the gate or the subtraction failed. Stop; restore the gate path from `$EVAL_ID`, re-snapshot, and re-judge. Never land a gate path into the target. |
| Refine needs an edge the plan did not name, or a different decision | Stop. An unnamed edge is a plan change; a different decision is a `new` unit (or a structure round). Do not fold either into the target. |
| Refine edge inverts topology | Stop. The new prerequisite must already precede the target; the skeleton restack is for gate placement, not a refine edge. Re-plan or move it to a structure round. |
| Reused refine gate already passes on the target | The gate is not red for the change. Report `gate-weak`; the user decides whether the change is already satisfied or the gate must be amended first. |
| `heads(all())` has a stray head after `workspace forget` | Run `scripts/set-round-tip.sh` first, then `scripts/abandon-empty-heads.sh`; it abandons verified empty, undescribed, unbookmarked, non-open-workspace, non-node heads. If the head is a restore of content an existing node owns, run it with `--force-stray` (byte-identical only). If the head is a conflicted copy of existing node documents, add `--force-superseded`. It still refuses a clean non-identical node copy. If it exits nonzero, stop and report the remaining head. Never `jj abandon` directly. |
| `heads(all())` has a non-empty head or more than one head after cleanup | Stop. The round produced a fork or left a real head; do not abandon a non-empty change or rebase. Report it and ask. |
| Session died | `deccy drafts`; `cd` into the workspace; `jj workspace update-stale`; `jj status`; resume. The draft record and workspace survive. |
| User changes scope mid-round | Stop the affected component; close or park its open drafts; re-plan that component as a new layer. Do not add a unit that was not in the approved layer. |
| Plan needs a second skeleton after drafts are open | Stop. A second `deccy new` pass would reparent every open draft. Close all drafts first, then re-plan the layer. |
