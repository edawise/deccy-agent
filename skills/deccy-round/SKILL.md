---
name: Deccy round
description: Planner and orchestrator protocol for a deccy layer — a breadth-only node plan, one skeleton pass, parallel components with frozen gates, adversarial judging and user-chosen alternatives.
metadata:
  opencode/autoinvoke: false
---

# Deccy round

A **round** is one approved **layer**: every node the planner proposes for the next frontier, built
together. The layer is partitioned into **components** — weakly connected sets of units over their
`depends_on` edges — and components run in parallel. Inside a component, units run in dependency
order: a frozen gate before each implementation, an adversarial judge before each landing.

This skill is for the **planner** (layer plan, read-only) and the **orchestrator** (the only graph
writer). Raw `jj` workspaces provide draft isolation; the existing `deccy new` / `deccy record` do
the graph writes. The protocol is the manual version of the future `deccy draft` / `record --from`
and of a future batch skeleton verb.

## Contract

- **Size.** `max_units_per_layer` defaults to 12 (`0` unlimited). It is a planning bound, not a
  concurrency bound: the skeleton pass is one linear stack and every record rebases every workspace
  above it, so a larger layer is split rather than attempted. `max_open_drafts` defaults to 6
  (`0` unlimited) and caps concurrent *implementation* drafts across all components. Alternatives
  are drafts of one unit, not extra units.
- **Barrier.** `round_barrier = refuse | warn | off`; default `refuse`. No new skeleton may be
  created while any workspace is open, and no trunk mutation is allowed while drafts are open
  except the planned gate/implementation landing.
- **One unit, one target.** A unit is a **new** decision node (plus its new evaluation) or a
  **refine** of an existing decision. Gate drafts and implementation drafts are separate. A refine
  edits the target's node and refs; it creates no skeleton.
- **Component independence.** A component is a weakly connected component of the planned units over
  the `on` edges; landed prerequisites do not connect units. Two components may run in parallel only
  because no plan edge connects them and they share no write path. If landing one component changes
  another component's gate behaviour, or two drafts touch one path, the partition was wrong: stop
  and re-plan.
- **Gate before implementation.** A new or amended gate is authored, checked for red (or explicitly
  accepted as a weak gate by the user), recorded and hash-frozen before a drafter starts. A reused
  gate is verified and frozen. The drafter may not edit the gate or its tests. Gate form and the
  red command are derived by the gate author from the evaluation matrix, not planned.
- **Forks before skeletons.** A fork is a choice that changes the content of dependent units
  (`A …` / `B …`). All skeletons are created before any workspace opens, so a fork must be chosen
  at plan approval or its dependants belong to the next layer. There is no second skeleton pass
  while workspaces are open.
- **Adversarial judge.** The drafter never attests green. The judge runs base-red and
  candidate-green clean-room from workspaces it creates, and reports a candidate verdict plus a
  gate assessment. Gate **integrity** failures block; gate **weakness** is advisory and the user
  decides whether to accept it or return the gate to its author.
- **User chooses.** Implementation alternatives are separate drafts; the user chooses one after
  judging. The orchestrator lands the chosen draft and forgets the rest.

## Roles

| Role | Skill | May write | Graph writes |
|---|---|---|---|
| Planner | `deccy-core` + `deccy-round` | plan dir only | none |
| Orchestrator | `deccy-core` + `deccy-round` | round state, workspaces | `deccy new/record`, draft landing |
| Gate author | `deccy-core` + `deccy-gate` | own gate workspace | none |
| Drafter | `deccy-core` + `deccy-author` | own implementation workspace | none |
| Judge | `deccy-core` + `deccy-judge` | own judge workspace | none |

The orchestrator never writes decision or evaluation content. The gate author never sees an
implementation draft. The drafter never sees another alternative. The judge never edits the
candidate or the graph.

## Round shape

```text
layer plan / user approval
  -> plan checks (edges, licences, forks, size)
  -> skeleton pass: ALL decision + gate skeletons, in dependency order, one stack
  -> handle map (U1..Un, G1..Gn -> change ids)
  -> partition into components
  -> per component, in parallel:
       gate drafts (author parallel, record serial) -> freeze hash
       implementation drafts (parallel / alternatives)
       judge clean-room (base red, candidate green)
       user choice -> land the chosen draft
  -> validate + topology + custody
```

Every skeleton is created before the first workspace, because `deccy new` uses `jj new -A` and
would reparent open workspaces. Afterwards the trunk is only touched by gate and implementation
landings. Each landing rewrites history above it, so every open workspace is refreshed with
`jj workspace update-stale` and its gate is re-run before the verdict is trusted.

New implementation drafts base at the frozen gate. Refine drafts base at the existing target so
they carry its current content; the gate paths are restored into the draft for running and
excluded from the landable set.

## Planner: the layer plan

The planner reads the graph and returns **one table** using `references/layer-plan.md`:

- the base, the seeds it read, the scope and the explicit exclusions;
- one row per node: local handle, `new` or `refine <id>`, the decision in one sentence, its
  `on` set, its gate action (`new` / `reuse` / `amend`), the paths it may write, any fork, and the
  recorded clause that licenses it;
- open questions and stop conditions.

Breadth only. The planner does not choose gate forms, write red commands or green conditions, keep
an ownership inventory beyond each row's `writes` cell, or propose implementation alternatives;
those are the gate author's and the drafter's, derived when the unit is executed. No graph writes,
no content, no tests.

If a prerequisite is unsettled, stop and report it; do not encode a guess in a lower unit. If a
unit has no licence in the recorded graph, it is not part of this layer.

## Orchestrator: the phases

Full commands and failure handling: `references/round-protocol.md`; jj gotchas:
`references/jj-direct.md`.

1. **Approve.** Read the layer plan; run `deccy validate`, `jj status`, `jj workspace list` and
   `jj log -r 'heads(all())'`. The base must be clean and single-headed with no open workspace.
   Check `max_units_per_layer`, the plan's edges and licences, and that every fork is chosen or
   its dependants are excluded. Ask the user to approve the plan; the gate forms follow from the
   evaluation matrix and weak gates are surfaced at judge time.
2. **Skeletons.** Create **every** decision and gate skeleton with `deccy new`, in dependency
   order, before opening any workspace. Resolve handles to change ids as they are created and
   write the map to the ledger. For `gate: new`, create the evaluation skeleton immediately after
   its decision with the same `on` set. Refine units create nothing.
3. **Components.** Partition the units into weakly connected components over the `on` edges,
   ignoring landed prerequisites. Open one workstream per component; components run in parallel,
   units inside a component in dependency order.
4. **Gates.** For each unit in a component, in dependency order, `jj workspace add` at its evaluation
   node and spawn the gate author. Gate drafts may be authored in parallel across components;
   inside a component, author them in dependency order because a unit's gate needs its
   prerequisites' landed content. **Record** them one at a time with `jj restore` + `deccy record`,
   then refresh every open workspace and hash-freeze. A reused gate is verified and frozen without a
   draft. An amended gate for a refine follows the check-workspace rule. A gate-author defect stops
   that unit; a judge `gate-weak` advisory does not.
5. **Implementation drafts.** For a new unit, `jj workspace add` at the frozen evaluation; for a
   refine, at the existing target with the gate paths restored for running. Spawn one drafter per
   draft, up to `max_open_drafts` at a time. Within a component, only units whose prerequisites have
   landed may draft. The drafter edits only the target node and its refs, runs the gate, and
   reports the **landable** paths. Alternatives are separate workspaces from the same base; drafters
   never see each other.
6. **Judge.** Spawn a judge per candidate. It creates clean base and candidate workspaces at the
   decision node, applies the gate, and runs base-red/candidate-green. It reports a candidate
   verdict, gate integrity and gate strength. Gate-integrity failures stop the unit; `gate-weak` is
   advisory. Nothing is recorded before the verdict.
7. **Choose and land per component.** When a component's candidates are judged, ask the user to
   choose any alternative and to accept or return any weak gate. Land the chosen draft, forget its
   workspaces, refresh the remaining open workspaces and re-run their gates, then abandon verified
   stray heads. Components land independently; a component does not wait for the others. If a
   landing changes another component's gate result, stop: the components were not independent.
8. **Close.** When every component has landed or stopped, run `deccy validate`, topology and
   custody checks; confirm `jj workspace list` is `default` only, `heads(all())` is exactly the
   working-copy head, and every gate still hashes to its frozen value. Report node ids, gates,
   verdicts, weak-gate advisories, landed/dropped paths, deviations and residual risks. The round
   is not done until the user approves the result. After approval, delete the round ledger with
   `scripts/delete-round-state.sh <round>`; it is live work state, not audit.

## Hard rules

- **No workspace before the last skeleton.** `deccy new` uses `jj new -A`, which reparents and
  makes every open workspace stale. Create all new skeletons first; never run `deccy new` while a
  workspace is open.
- **Forks freeze before skeletons.** If a fork is unchosen, its dependants are not in this layer.
  Do not create their skeletons "provisionally".
- **Records and landings are serial.** Gate and implementation landings are graph writes by the
  orchestrator only. Authoring and judging may overlap; recording may not.
- **Refresh after every record.** A record rebases the changes above it. Run
  `jj workspace update-stale` in every open workspace, re-check `jj diff`, and re-run the frozen
  gate before trusting a verdict. A conflict means the draft is stale: rebuild it from the current
  gate.
- **Refine gate paths are not landable.** A refine draft restores the gate test so it can run it;
  that path stays in the evaluation. Land only the target node and its own refs. A draft that edits
  a gate path is a gate-integrity failure.
- **A refine is not a new decision.** If the change needs a different commitment, a new `depends_on`
  edge or a new node, stop and plan a `new` unit instead.
- **Do not record a draft before the judge.** Judge every candidate clean-room; record only the
  accepted content.
- **No self-attested red/green.** The gate author's red run is planning evidence; the judge's
  clean-room run is acceptance evidence. Quote commands and output.
- **No gate edits after freeze.** If the gate is wrong, stop and return it to the gate author; do
  not weaken it to fit the implementation.
- **Weak gates are advisory, not vetoes.** The judge reports `gate-weak` with evidence; only
  gate-integrity failures stop the unit. The user decides. An amended gate voids the old hash and
  verdict; re-freeze and re-judge.
- **No graph writes by non-orchestrators.** Drafters and gate authors edit files in their
  workspaces; the orchestrator lands them. The judge is read-only.
- **Clean up stray heads.** `jj workspace forget` may leave a head. After all drafts are forgotten,
  run `scripts/abandon-empty-heads.sh`; use `--force-stray` only for a head whose every changed path
  is a byte-identical restore of an existing node document. Never run `jj abandon` directly. A
  nonzero exit is a stop.
- **Summary updates are the one `jj describe` exception.** After a landing, update a node's jj
  summary with `jj describe -m "<summary>" <id>`: summary only, never content or edges.
- **Delete the round ledger at close.** `ROUND.md` is live work state, not audit. After the user
  approves the close report, run `scripts/delete-round-state.sh <round>`; it removes the ledger and
  the empty round directory. The close report is the durable record. Never delete a workspace, a
  node, or anything outside `rounds/`.
- **Stop rules.** Missing node/edge, unsettled prerequisite, unresolved fork, `deccy record`
  refusal, stale conflict, a judge rejection, or a gate-integrity failure: stop the affected unit
  or component, report, and ask. A `gate-weak` advisory is not a stop; it is a user choice. Do not
  force a landing.

## Workspaces

Use a root outside the repository so the trunk working copy never sees draft files:

```sh
ROOT="$HOME/.local/share/deccy/agent"
WS="$ROOT/workspaces/drafts/<round>/<component>/<handle>"
```

`jj workspace add "$WS" --name "deccy-<round>-<component>-<handle>" -r <base-change-id>` creates the
draft as a child of `<base-change-id>`. For a new unit the base is the frozen evaluation; for a
refine it is the existing target, and the orchestrator restores the gate paths into the draft for
running. The draft is the workspace's `@`; edit in place, do not run `jj new` inside it. Always run
jj from inside the workspace (`cd "$WS" && jj ...`); `-R` from the trunk can report
non-repo-relative paths for an outside workspace.

Round state lives in `$ROOT/rounds/<round>/ROUND.md` (not in the graph). It records the layer plan,
the handle map, the component partition, workspace names, draft change ids, landable paths, gate
hashes, judge verdicts and the user's choices. It is live work state, not audit: keep it current
while the round is open, then delete it after approval. The final CLI will replace this scratch
ledger with `.deccy/work/`.

## Reading order

- `references/round-protocol.md` — the phase-by-phase commands and refusal handling.
- `references/layer-plan.md` — the planner's breadth-only template and checks.
- `references/jj-direct.md` — the workspace protocol, allowed raw jj, stale/cleanup gotchas.
