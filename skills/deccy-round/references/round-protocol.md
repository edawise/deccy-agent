# Round protocol: layer plan, skeleton pass, parallel components

This is the executable version of the round. Run it from the repository root. The orchestrator is
the only agent that mutates the graph; everyone else edits files in a workspace and reports.

## 0. Names and state

```sh
ROUND="r$(date +%Y%m%d-%H%M%S)"
ROOT="${DECCY_AGENT_ROOT:-$HOME/.local/share/deccy/agent}"
STATE="$ROOT/rounds/$ROUND/ROUND.md"
MAP="$ROOT/rounds/$ROUND/map.tsv"
mkdir -p "$ROOT/rounds/$ROUND" "$ROOT/workspaces/drafts/$ROUND" "$ROOT/workspaces/judge/$ROUND"
```

`ROUND.md` is the prototype ledger. It is **not** in the graph. Keep it current while the round is
open; it is live work state, not audit, and is deleted at close (see 9.1). It covers the whole
layer, including every component:

```markdown
# Round <id> — layer <name>
base: <change id>
barrier: refuse
max_units_per_layer: 12
max_open_drafts: 6
## Layer plan
| # | act | decision | on | gate | writes | fork | licensed by |
## Skeleton map
| handle | kind | change id | component |
## Components
| component | units | state |
## Drafts
| component | unit | handle | mode | workspace | target | draft change | paths | state |
## Verdicts
| draft | base-red | candidate-green | verdict | notes |
## Choices
| unit | alternatives offered | user choice | weak-gate decision |
```

The **handle map** is the only link between the plan's local handles and change ids. Write a row
when `deccy new` prints an id; never guess one. `map.tsv` is `handle<TAB>change-id`, one per line.

## 1. Approve the layer plan

1. The planner returns a layer plan from `references/layer-plan.md`. The orchestrator checks it
   against the graph (see 2).
2. Check the size: `max_units_per_layer` defaults to 12 (`0` unlimited). Above it, split the layer;
   do not raise the bound to fit one plan.
3. Check for open workspaces:

   ```sh
   jj workspace list
   ```

   If any are open and the barrier is `refuse`, stop: resume or close them first. `warn` reports
   and asks; `off` proceeds only with the user's explicit approval.
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
4. Every row carries a licence: a recorded clause or an earlier plan row.
5. No row depends on an unchosen fork. If one does, remove the dependants from this layer (they
   belong to the next one); do not create their skeletons provisionally.
6. Every row carries a `writes` set, and two rows share a path only along an `on` chain.
7. Every recorded id named in `on` is an ancestor of the base tip; otherwise the skeleton pass could
   fork. Check each one with `jj log -r '<id>::@' --no-graph -T 'change_id.shortest(8)'`; an empty
   result means it is not an ancestor.
8. The layer is not larger than `max_units_per_layer`.

A failed check stops the round. Do not repair a plan by inventing a node, an edge or a gate.

## 3. Skeleton pass (all nodes before any workspace)

`deccy new` uses `jj new -A` at the unique head of its `--on` set. Creating a skeleton therefore
reparents history and makes every open workspace stale, so **all** skeletons are created here,
before the first workspace. Because the pass appends in one line, every `--on` set has a unique
head and cannot fork.

```sh
id=$(deccy new -m "<decision summary>" --on <dep-id> --on <dep-id>)
```

Resolve handles through `map.tsv` before calling `deccy new`:

```sh
resolve() {
  hit=$(awk -F '\t' -v h="$1" '$1==h{print $2}' "$MAP")
  printf '%s\n' "${hit:-$1}"
}
on=$(resolve U1); on2=$(resolve <recorded-id>)
id=$(deccy new -m "<decision>" --on "$on" --on "$on2")
printf '%s\t%s\n' U2 "$id" >> "$MAP"
```

For each `new` row, in dependency order:

1. Resolve its `on` handles to change ids through `map.tsv`; leave recorded ids as they are.
2. `deccy new -m "<decision>" --on ...`; record `handle<TAB>id` in `map.tsv`.
3. If `gate: new`, immediately create the evaluation skeleton with the **same** `on` set:

   ```sh
   deccy new -m "gate: <decision>" --on <same dep ids>
   # the skeleton is a decision with a placeholder; the gate author changes it to kind=evaluation,
   # adds evaluates, and writes content.ref in the gate draft.
   ```

   Record `G-<handle><TAB>id`. The `--on` set is what makes I4 coverage structural: the evaluation
   depends on exactly the decision's prerequisites and evaluates the decision.

For a `refine <existing id>` row, create nothing. Record the target id under its handle, its
current `ref` paths, its current `depends_on` set, and whether its gate is `reuse`d or `amend`ed.

Do not edit a skeleton in the trunk. The role authors write the full node document (including
`content.ref`) in their drafts. At landing, if a path is a new `ref`, record the node JSON first,
then the new path (see 5.3 and 8).

**Do not open a workspace until every skeleton for the layer exists.** After this phase the trunk
is not touched again except by gate and implementation landings.

`deccy validate` is expected to be unhappy during this phase: placeholders and not-yet-authored
evaluation skeletons leave coverage holes. Validate at the end of each unit's gate step and at
close, not immediately after the pass.

## 4. Partition into components

Build the graph induced by the planned units: an edge `U -> V` when `U`'s `on` names `V`'s handle.
Recorded prerequisites do not create edges; they are already landed and connect nothing.

Each **weakly connected component** is one track. Units inside a component run in dependency order.
Components run in parallel: they share no plan edge, so a landing in one cannot change another's
prerequisite semantics.

A shared write path is not a component edge; it is a plan error. Check 6 already requires two rows
that share a path to sit on one `on` chain. If you find a shared path across components, stop and
re-plan: do not invent an order between them.

Write the partition into the ledger. If the partition produces one giant component (everything
chains through one unit), that is a planning result, not a failure: it serialises, and the planner
should be asked whether the chain can be cut in the next layer.

## 5. Gate drafts: author parallel, record serial

Gate drafts may be authored concurrently across components because each bases at its own evaluation
node. Inside a component, author them in dependency order: a unit's gate needs its prerequisites'
landed content. Gates must be **recorded** one at a time: a record rewrites every change above the
target, so every other open workspace needs a refresh afterwards.

### 5.0 Reuse or amend a refine gate

A **new** unit has a new evaluation. A **refine** unit may reuse its existing evaluation or amend
it.

**Reuse.** Read the existing `$EVAL_ID`, confirm it still covers every edge the refine uses, then
compute `$GATE_PATHS`/`$GATE_HASH` with 5.4 (skip the recording step). Do not open a gate draft. If
the reused gate already passes on the target's current state and the refine is meant to change
behavior, the gate is not red for that change: amend it or report that the change is already
satisfied.

**Amend.** Open a gate draft at the existing evaluation, exactly as 5.1. If the evaluation branch
does not include the existing target, the orchestrator also opens a **check workspace** at the
target and restores the new test paths into it; the gate author only runs the red command there:

```sh
CHECK="$ROOT/workspaces/drafts/$ROUND/<component>/gate-check-<handle>"
jj workspace add "$CHECK" --name "deccy-$ROUND-<component>-gate-check-<handle>" -r "$TARGET_ID"
cd "$CHECK"
printf '%s\n' "$NEW_GATE_PATHS" | xargs -r jj restore --from "$GATE_DRAFT" --to @ --
# hand $CHECK to the gate author; it runs <red command> there and does not edit the target
```

The check workspace is evidence only. Forget it after the red run. Land the gate draft into the
evaluation with 5.3, freeze with 5.4, then continue.

### 5.1 Open

```sh
WS="$ROOT/workspaces/drafts/$ROUND/<component>/gate-<handle>"
NAME="deccy-$ROUND-<component>-gate-<handle>"
jj workspace add "$WS" --name "$NAME" -r "$EVAL_ID"
```

The workspace's `@` is a child of the evaluation node; `@-` includes the prerequisite and either
the new skeleton or the existing evaluation being amended. Edit in place.

### 5.2 Author and red

The gate author writes:

- `nodes/<EVAL_ID>.json`: `kind: evaluation`, `evaluates`, `depends_on`, `content.type`,
  `content.ref` and `content.rationale`;
- the test/criteria files listed in `content.ref`.

The gate author **derives the form** from the evaluation matrix (parent layer × child layer) and
then derives the red command from the form. The plan carries neither. Test and criteria paths stay
inside the unit's `writes` set; a path outside it means the plan is wrong: stop, do not silently
widen the row.

Before running red, refresh the workspace (§6.0); another component's record may have moved the
base. Then:

```sh
cd "$WS"
<red command>
```

For a **new** gate, run against the prerequisite without the implementation. For an **amended**
gate, run against the existing target's current state (see 5.0). It must fail for the reason the
gate names; capture the command and failure. A test that passes before the implementation is
already satisfied or not testing the decision: stop and fix the gate, unless it is an intentionally
weak review criterion; then report it as weak and let the user accept the advisory.

### 5.3 Land

```sh
# inside the draft workspace, after the author reports
cd "$WS"
jj status
jj diff --summary -r @
DRAFT=$(jj log -r @ --no-graph -T 'change_id.shortest(8)')
PATHS=$(jj diff --summary -r @ | sed -n 's/^[A-Z] //p')
# Prototype path rule: no spaces in draft paths; the xargs landing splits on whitespace.

# in the trunk
cd <repo-root>
jj new "$EVAL_ID"
printf '%s\n' "$PATHS" | xargs -r jj restore --from "$DRAFT" --to @ --
# if any path is a new ref, two-step:
#   deccy record nodes/<EVAL_ID>.json --to "$EVAL_ID"
#   printf '%s\n' "$NEW_PATHS" | xargs -r deccy record --to "$EVAL_ID"
printf '%s\n' "$PATHS" | xargs -r deccy record --to "$EVAL_ID"
jj workspace forget "$NAME"
jj new "$EVAL_ID"
# then refresh every other open workspace (§6.0) before continuing
```

`workspace forget` does not reliably remove a forgotten working-copy commit. After all drafts are
forgotten, the close-out cleanup in §8.1 abandons verified stray heads; never run `jj abandon`
directly.

`deccy record` refuses a path that is not changed in the trunk working copy or not owned by the
evaluation. Do not work around a refusal with `jj squash`; inspect the paths and the evaluation's
`ref`, fix the draft, and retry.

**New ref paths.** Ownership is checked against the target's current document. If a draft adds a
path that is not yet in the target's `ref`, the one-call record refuses it. The draft's node JSON
must list the new path in `content.ref`; record the node file first, which updates the ref list,
then record the new path. If the path was not planned, stop and re-plan.

### 5.4 Freeze the gate

After recording a new or amended gate (or for a reused gate, immediately), read the evaluation's
refs — including unchanged existing tests — and hash the evaluation document plus every ref path at
the evaluation revision:

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
an amended gate, this hash replaces the old one; any verdict based on the old hash is void.

## 6. Implementation drafts: parallel, at the frozen gate

### 6.0 Refresh after a record

Any record rebases the changes above the target. Before authoring, running a gate, judging or
landing in any open workspace, refresh it:

```sh
cd "$WS"
jj workspace update-stale
jj status
jj diff --summary -r @        # must still be the draft you think it is
```

Then re-run the frozen gate. If the gate's result changed, stop: the workspaces were not
independent, or the draft was edited after judging. A conflict means the draft is stale; rebuild it
from the current gate rather than resolving it by hand.

### 6.1 New unit

For a new decision with one gate, base the draft at the gate evaluation so the test is already in
the tree:

```sh
WS="$ROOT/workspaces/drafts/$ROUND/<component>/impl-<handle>"
NAME="deccy-$ROUND-<component>-impl-<handle>"
jj workspace add "$WS" --name "$NAME" -r "$EVAL_ID"
```

The workspace's `@` is a child of the evaluation; `@-` contains the gate test and the prerequisite.
The drafter writes:

- `nodes/<DECISION_ID>.json` (the full document; the skeleton may be an ancestor or a sibling
  depending on creation order, so do not rely on editing an existing copy);
- the decision's `ref` files (implementation);
- nothing else.

Do not edit any path in `$GATE_PATHS`. Run the frozen gate:

```sh
cd "$WS"
<green command>
```

Capture the command and output. Reject your own work if the gate fails; do not edit the gate.

### 6.2 Refine unit

For a refine, base the draft at the **existing target**, not at the evaluation, so it carries the
target's current node and refs:

```sh
WS="$ROOT/workspaces/drafts/$ROUND/<component>/refine-<handle>"
NAME="deccy-$ROUND-<component>-refine-<handle>"
jj workspace add "$WS" --name "$NAME" -r "$TARGET_ID"
cd "$WS"
printf '%s\n' "$GATE_PATHS" | xargs -r jj restore --from "$EVAL_ID" --to @ --
```

The gate paths are now in the workspace **for running only**. They are expected to appear in
`jj diff --summary -r @` if they are not already in the target's tree; they are not part of the
refine and must not be landed. The drafter edits the target's node JSON and its own ref files, runs
the gate, and reports:

```sh
cd "$WS"
jj status
DRAFT=$(jj log -r @ --no-graph -T 'change_id.shortest(8)')
PATHS=$(jj diff --summary -r @ | sed -n 's/^[A-Z] //p')
LANDABLE_PATHS=$(printf '%s\n' "$PATHS" | grep -vxF -f <(printf '%s\n' "$GATE_PATHS" | sed '/^$/d') || true)
# uses bash/zsh process substitution; run in bash or zsh
```

`LANDABLE_PATHS` becomes the refine `DRAFT_PATHS` used by the judge and the landing. It must
contain only the target node file and the target's current or planned `ref` files. A gate path in
`LANDABLE_PATHS` is a gate-integrity failure; a path outside the target's refs is a custody defect.

### 6.3 Packet

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
chooses after judging. Alternatives do not count against `max_open_drafts` as extra units, but they
do count as open workspaces.

## 7. Judge drafts before recording

The judge uses **two clean workspaces at the decision node**, not the drafter's workspace.

It reports three things: a **candidate verdict** (`accept` / `reject` / `inconclusive`), **gate
integrity** (`intact` / `broken`), and **gate strength** (`sound` / `weak`). `gate-integrity` blocks:
the evidence cannot be trusted. `gate-weak` is **advisory**: the candidate may still be accepted,
and the orchestrator asks the user whether to accept the weak gate or return it to the gate author.
The judge never vetoes a candidate on weakness.

```sh
JROOT="$ROOT/workspaces/judge/$ROUND/<component>/<handle>"
jj workspace add "$JROOT/base" --name "deccy-$ROUND-<component>-<handle>-base" -r "$DECISION_ID"
jj workspace add "$JROOT/cand" --name "deccy-$ROUND-<component>-<handle>-cand" -r "$DECISION_ID"
```

Both workspaces' `@` are children of the decision node. The candidate is `@-` in each. Refresh both
(§6.0) before running anything.

### 7.1 Base-red

```sh
cd "$JROOT/base"
printf '%s\n' "$GATE_PATHS" | xargs -r jj restore --from "$EVAL_ID" --to @ --
<red command>                              # should fail for the gate's reason
```

A **pass** is not a candidate rejection: record `gate strength: weak` (no base-red) and continue.
A crash from a broken harness or unrelated fixture is `inconclusive`; report exactly what is broken.

### 7.2 Candidate-green

```sh
cd "$JROOT/cand"
printf '%s\n' "$GATE_PATHS" | xargs -r jj restore --from "$EVAL_ID" --to @ --
printf '%s\n' "$DRAFT_PATHS" | xargs -r jj restore --from "$DRAFT" --to @ --
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
jj workspace forget "deccy-$ROUND-<component>-<handle>-base"
jj workspace forget "deccy-$ROUND-<component>-<handle>-cand"
```

Record the base-red output, candidate-green output, gate integrity, gate strength, extra checks and
verdict in the ledger. A `gate-weak` advisory is recorded even when the candidate is accepted.

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
jj new "$TARGET_ID"
printf '%s\n' "$DRAFT_PATHS" | xargs -r jj restore --from "$DRAFT" --to @ --
printf '%s\n' "$DRAFT_PATHS" | xargs -r deccy record --to "$TARGET_ID"
jj workspace forget "$NAME"
jj new "$TARGET_ID"
# then refresh every other open workspace (§6.0) and re-run its gate
```

`$TARGET_ID` is the new decision for a `new` unit and the existing decision for a `refine` unit.
Land exactly the judged paths. For a refine, never restore or record `$GATE_PATHS`; they belong to
the evaluation. If a landable path is a new `ref` for the target, record `nodes/<target>.json`
first, then record the new path. If the draft changed after judging, the verdict is stale: rejudge
or reject. After the record, re-read the target and compare the landed paths to the draft; the gate
hash must still match.

For a unit with no alternative, the same sequence records the single judged draft.

Land a component's units in dependency order. Components land independently: a finished component
does not wait for the others. After each landing, refresh every other open workspace and re-run its
gate. If a gate result changes because another component landed, stop: the components were not
independent and the plan's partition was wrong.

Forget every losing alternative with `jj workspace forget`.

### 8.1 Clean up stray heads

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
working-copy commit, and not a node's own change (`nodes/<id>.json`). With `--force-stray`, it also
abandons a head whose every changed path is a byte-identical restore of an existing node document —
the gate-path-only head a review-criteria refine can leave. It refuses any other non-empty diff. It
exits nonzero if any other head remains. Never run `jj abandon` directly. A nonzero exit is a stop:
report the remaining head and ask, rather than forcing a one-line history.

## 9. Close

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

- the layer plan and the component partition that was executed;
- the node ids created or edited, and their gates;
- each draft, its judge verdict, and the user's choice;
- every path landed and every path dropped;
- every deviation from the plan, with why;
- residual risks (the linear skeleton stack, refined gates, new refs landed in two records, and any
  component that had to be serialised).

The round is complete when the user approves the recorded result, not when the scripts pass.

### 9.1 Delete the ledger

After the user approves the close report, delete the round ledger:

```sh
~/.config/opencode/skills/deccy-round/scripts/delete-round-state.sh "$ROUND"
```

`ROUND.md` is live work state, not audit: the close report is the durable record. The script removes
`rounds/$ROUND/ROUND.md` and the empty round directory; it refuses a missing or malformed round id,
a path outside `rounds/`, and a symlinked round directory. It never deletes a workspace, a node, or
anything outside the round's own directory. A nonzero exit is a stop: report it and ask. `map.tsv`
lives in the same directory; remove it before the directory delete, or let the script keep the
directory and remove both files first.

## 10. Failure handling

| Symptom | Action |
|---|---|
| `jj workspace list` shows `stale` | `cd "$WS" && jj workspace update-stale`; re-check `jj diff`; if it conflicts with the new base, abort the draft and re-open it from the current gate. |
| Gate result changes after another component lands | Stop the affected component. The partition was wrong or the draft changed; re-plan rather than forcing independence. |
| `deccy record` refuses a path | Inspect `jj diff --summary -r @` and the target's `ref`/node file. If it is a new ref, record the node file first, then the ref path; if it is unplanned, stop and re-plan. Never `jj squash` by hand. |
| Draft has a rename | Discard the rename; use add + delete, or defer to the final CLI. `jj diff --summary` reports renames as one field and the landing path set becomes ambiguous. |
| Judge says reject | Open a fresh `rev2` draft from the same gate; keep the rejected draft until the component closes for evidence, then forget it. Do not edit the gate to fit. |
| Judge reports gate-weak | Advisory, not a stop. Record the evidence and ask the user whether to accept the weak gate or return it to the gate author. The candidate may stand. If the user returns it, the gate author amends; the old hash and verdict are void; re-freeze and re-judge. |
| Judge reports gate-integrity | Stop the unit. The gate author reopens a gate draft; the old hash and verdict are void. Re-record the gate, re-freeze, re-open implementation drafts. |
| Refine landable set contains a gate path | The draft edited the gate or the path subtraction failed. Stop; restore the gate path from `$EVAL_ID`, re-snapshot, and re-judge. Never land a gate path into the target. |
| Refine needs a new edge or a different decision | Stop. That is a `new` unit (or a structure round), not a refine; do not fold it into the target. |
| Reused refine gate already passes on the target | The gate is not red for the change. Report `gate-weak`; the user decides whether the change is already satisfied or the gate must be amended first. |
| `heads(all())` has a stray head after `workspace forget` | Run `scripts/abandon-empty-heads.sh`; it abandons verified empty, undescribed, unbookmarked, non-open-workspace, non-node heads. If the head is a gate-path-only restore, run it with `--force-stray`, which requires every changed path to be a byte-identical restore of an existing node document. If it exits nonzero, stop and report the remaining head. Never `jj abandon` directly. |
| `heads(all())` has a non-empty head or more than one head after cleanup | Stop. The round produced a fork or left a real head; do not abandon a non-empty change or rebase. Report it and ask. |
| Session died | `jj workspace list`; `cd` into the workspace; `jj status`; resume. The workspace and draft change survive. |
| User changes scope mid-round | Stop the affected component; close or park its open drafts; re-plan that component as a new layer. Do not add a unit that was not in the approved layer. |
| Plan needs a second skeleton after workspaces are open | Stop. A second `deccy new` pass would reparent every open workspace. Close all drafts first, then re-plan the layer. |
