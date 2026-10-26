---
name: Deccy round
description: Planner and orchestrator protocol for a small deccy round with parallel jj draft workspaces, frozen gates, adversarial judging and user-chosen alternatives.
metadata:
  opencode/autoinvoke: false
---

# Deccy round

A **round** is a small, connected batch of decisions built together: 1–5 units by default, one
user-approved brief, parallel draft workspaces, a frozen gate before implementation, and an
adversarial judge before anything is recorded. This skill is for the **planner** (brief, read-only)
and the **orchestrator** (the only graph writer).

The protocol uses raw `jj` workspaces for isolation and the existing `deccy new` / `deccy record`
for graph writes. It is the manual version of the future `deccy draft` / `record --from`; it is
not a throwaway CLI.

## Contract

- **Size.** `max_open_units` defaults to 5; `0` means unlimited. Count round units from the brief,
  not workspaces or gate targets. Gate and implementation drafts belong to their unit; alternatives
  are multiple drafts of one unit. Do not exceed the cap without the user changing it.
- **Barrier.** `round_barrier = refuse | warn | off`; default `refuse`. In the prototype the
  orchestrator enforces it: no new skeleton or landing while an unrelated unit is open, and no
  trunk mutation while drafts are open except the planned gate/implementation landing.
- **One unit, one target.** A unit is a **new** decision/evaluation node or a **refine** of an
  existing decision, plus its draft. Gate drafts and implementation drafts are separate. A refine
  edits the target’s node and refs; it does not create a skeleton.
- **Gate before implementation.** A new or amended gate is authored, checked for red (or explicitly
  accepted as a weak gate by the user), recorded and hash-frozen before a drafter starts; a reused
  gate is verified and frozen. The drafter may not edit the gate or its tests.
- **Adversarial judge.** The drafter never attests green. The judge runs base-red and
  candidate-green clean-room, from a workspace it creates, and reports a candidate verdict plus a
  gate assessment. Gate **integrity** failures block; gate **weakness** is advisory and the user
  decides whether to accept it or return the gate to the gate author. The judge does not write the
  graph or veto on weakness.
- **User chooses.** Alternatives are separate drafts; the user chooses one. The orchestrator
  lands the chosen draft and forgets the rest.

## Roles

| Role | Skill | May write | Graph writes |
|---|---|---|---|
| Planner | `deccy-core` + `deccy-round` | plan dir only | none |
| Orchestrator | `deccy-core` + `deccy-round` | round state, workspaces | `deccy new/record`, draft landing |
| Gate author | `deccy-core` + `deccy-gate` | own gate workspace | none |
| Drafter | `deccy-core` + `deccy-author` | own implementation workspace | none |
| Judge | `deccy-core` + `deccy-judge` | own judge workspace | none |

The orchestrator never writes decision/evaluation content. The gate author never sees an
implementation draft. The drafter never sees another alternative. The judge never edits the
candidate or the graph.

## Round shape

```text
brief / user approval
  -> skeletons for new units (deccy new, dependency order)
  -> gate drafts for new/amended gates (author red, record, freeze hash)
     or freeze an existing gate for reuse
  -> implementation drafts:
       new unit      -> base at the frozen gate
       refine unit   -> base at the existing target, gate paths restored for running
  -> judge drafts (base-red + candidate-green, no graph write)
  -> user choice
  -> record chosen draft; forget all drafts
  -> validate + topology + custody
```

Safe default for the prototype: **gates serial, implementations parallel**. Parallel gate drafts
become stale as soon as the first gate is recorded; only parallelize them after `record --from`
lands. New implementation drafts base at the frozen gate. Refine drafts base at the existing
target so they carry its current content; the gate paths are restored into the draft for running
and excluded from the landable path set.

## Planner: the brief

The planner reads the graph and returns **one page** using `references/round-brief.md`:

- scope and the 1–5 units;
- for each unit: mode (`new` or `refine <existing id>`), target node, `depends_on` set, gate
  (new / reuse / amend), gate form, red command, green condition, owned paths, alternatives;
- for a refine: the target’s current content, the gate paths that are restored but not landed,
  and whether the existing gate still covers the use;
- the order and the gate for every edge the round will use;
- what is explicitly out of scope;
- open questions for the user.

No graph writes, no content, no tests. If a prerequisite is unsettled, stop and put it in the
brief; do not encode a guess in a lower gate.

## Orchestrator: the phases

Full commands and failure handling: `references/round-protocol.md`; jj gotchas:
`references/jj-direct.md`.

1. **Approve.** Read the brief; check cap/barrier and `jj workspace list`; run `deccy validate`;
   confirm the base is clean. Ask the user to approve the brief and the cap.
2. **Skeletons.** For **new** units, create every decision and evaluation skeleton with
   `deccy new` in dependency order. Do not edit the skeleton in the trunk; record the planned refs
   in the round state and let the role author write the full node (including `content.ref`) in its
   draft. For **refine** units, create nothing: record the existing target id, its current refs and
   its gate. Do all `deccy new` calls **before** opening any workspace.
3. **Gates.** For a new gate or an amended gate, `jj workspace add` at the evaluation node; the
   gate author writes the evaluation content and tests, runs the red command, and reports paths +
   evidence. Land it with `jj restore` + `deccy record`, then hash-freeze it. For a **reused**
   gate, verify it still covers the use and hash-freeze the existing evaluation; do not edit it.
   If an amended gate must be run red against an existing target, open a check workspace at the
   target for the gate author and keep it separate from the gate draft.
4. **Implementation drafts.** For a **new** unit, `jj workspace add` at the frozen gate evaluation;
   the draft already contains the gate test. For a **refine** unit, `jj workspace add` at the
   **existing target**, then restore the gate paths from the evaluation into the draft for running.
   The drafter edits only the target node and its refs, runs the gate, and reports the **landable**
   paths (the draft diff minus gate paths). For alternatives, open one draft per alternative from
   the same base/gate.
5. **Judge drafts.** Before recording an implementation, the judge creates clean base and
   candidate workspaces at the decision node, applies the gate test and (for the candidate) the
   **landable** draft paths, and runs base-red/candidate-green. It reports a candidate verdict, gate
   integrity and gate strength; gate weakness is advisory, not a verdict. No graph write. For a
   refine, “decision node” is the existing target and the base is its current state.
6. **Choose and land.** On accept, the user chooses an alternative (if any). If the judge reports
   `gate-weak`, ask the user explicitly whether to accept the weak gate or return it to the gate
   author; record the advisory. The orchestrator lands the chosen draft with `jj restore` +
   `deccy record`, forgets every draft workspace including losers, and returns the trunk working
   copy to the round tip. Then run `scripts/abandon-empty-heads.sh` to abandon the heads a
   forgotten workspace can leave; use `--force-stray` for a head whose every changed path is a
   byte-identical restore of an existing node document (a gate path restored for review). For a
   refine, land only the landable paths; gate paths stay in the evaluation. If a landable path is
   a new `ref`, record the node JSON first, then the new path. Update the landed summary only with
   `jj describe -m "<summary>" <id>`; never content or edges.
7. **Close.** Run `deccy validate`, topology and custody checks; confirm `heads(all())` is exactly
   the working-copy head; report node ids, gates, verdicts, gate-weak advisories, deviations and
   residual risks. The round is not done until the user approves the result. After approval, delete
   the round ledger with `scripts/delete-round-state.sh <round>`; it is live work state, not audit,
   and is not retained.

## Hard rules

- **No trunk mutation while drafts are open** except the planned landing of a gate or the chosen
  implementation. `deccy new` uses `jj new -A`, which reparents and makes every open workspace
  stale. Create all new skeletons first.
- **Refine gate paths are not landable.** A refine draft restores the gate test so it can run it;
  that path stays in the evaluation. Land only the target node and its own refs. A draft that
  edits a gate path is a gate-integrity failure.
- **A refine is not a new decision.** If the change needs a different commitment, a new
  `depends_on` edge, or a new node, stop and plan a `new` unit instead.
- **Do not record a draft before the judge.** Judge the draft via the clean-room protocol; record
  only the accepted content. This keeps rejected alternatives out of the graph.
- **No self-attested red/green.** The gate author's red run is planning evidence; the judge's
  clean-room run is the acceptance evidence. Quote commands and output.
- **No gate edits by the drafter.** If the gate is wrong, stop and return it to the gate author;
  do not weaken it to fit the implementation.
- **Weak gates are advisory, not vetoes.** The judge reports `gate-weak` with its evidence; only
  gate-integrity failures stop the unit. The user decides whether to accept the weak gate or ask
  the gate author to amend it. An amended gate voids the old hash and verdict; re-freeze and
  re-judge.
- **No graph writes by non-orchestrators.** Drafters and gate authors edit files in their
  workspace; the orchestrator lands them. The judge is read-only.
- **Clean up stray heads.** `jj workspace forget` may leave a head. After all drafts are
  forgotten, run `scripts/abandon-empty-heads.sh`; it abandons verified empty, undescribed,
  unbookmarked, non-open-workspace, non-node heads. Use `--force-stray` for a head whose every
  changed path is a byte-identical restore of an existing node document (for example a gate path
  restored for review); it refuses any other non-empty diff. Never run `jj abandon` directly. A
  nonzero exit is a stop.
- **Summary updates are the one `jj describe` exception.** After a landing, update a node's jj
  summary with `jj describe -m "<summary>" <id>`: summary only, never content or edges. The CLI
  has no re-describe verb; `deccy-core/references/cli.md` records the exception.
- **Delete the round ledger at close.** `ROUND.md` is live work state, not audit. After the user
  approves the close report, run `scripts/delete-round-state.sh <round>`; it removes the ledger and
  the empty round directory. The close report is the durable record. Never delete a workspace,
  node, or anything outside `rounds/`.
- **Stop rules.** Missing node/edge, unsettled prerequisite, `deccy record` refusal, stale
  conflict, a judge rejection, or a gate-integrity failure: stop, report, and ask. A `gate-weak`
  advisory is not a stop; it is a user choice. Do not force a landing.

## Workspaces

Use a root outside the repository so the trunk working copy never sees draft files:

```sh
ROOT="$HOME/.local/share/deccy/agent"
WS="$ROOT/workspaces/drafts/<round>/<handle>"
```

`jj workspace add "$WS" --name "deccy-<round>-<handle>" -r <base-change-id>` creates the draft as
a child of `<base-change-id>`. For a new unit the base is the frozen gate evaluation; for a refine
it is the existing target, and the orchestrator restores the gate paths into the draft for
running. The draft is the workspace's `@`; edit in place, do not run `jj new` inside it. Always run
jj from inside the workspace (`cd "$WS" && jj ...`); `-R` from the trunk can report
non-repo-relative paths for an outside workspace.

Round state lives in `$ROOT/rounds/<round>/ROUND.md` (not in the graph). It records the brief,
target ids, workspace names, draft change ids, changed paths, gate hashes, judge verdicts and the
user's choice. It is live work state, not audit: keep it current while the round is open, then delete
it after approval with `scripts/delete-round-state.sh <round>`. The final CLI will replace this
scratch ledger with `.deccy/work/`.

## Reading order

- `references/round-protocol.md` — the phase-by-phase commands and refusal handling.
- `references/jj-direct.md` — the workspace protocol, allowed raw jj, stale/cleanup gotchas.
- `references/round-brief.md` — the planner's one-page template.
