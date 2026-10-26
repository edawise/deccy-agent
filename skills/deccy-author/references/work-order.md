# Work order

> **Round.** The gate is authored, recorded and frozen by the gate author, not by the
> drafter. In the cycle below, “Gate” means *confirm the frozen gate and its hash*, and “Red” means
> *run the already-authored gate on the base if asked*. The drafter implements green and never
> writes or edits the gate. The planner owns descent; the orchestrator owns recording.
>
> **Refine.** For a refine unit the base is the existing target’s current state, the draft is based
> at the target, and the gate paths are restored into the draft for running only. The landable set
> is the draft diff minus the gate paths; the refine does not create a node or a new edge.

The graph fixes *what* is decided and *what* checks it. This file fixes **when**: work descends
through the decision graph, and every edge is gated before the dependent that uses it is built.

## The unit of work is the edge

For a `depends_on` edge `A → B`, `A` is the dependent and `B` the prerequisite. The evaluation
`E` (`E.evaluates ∋ A`, `E.depends_on ∋ B`) is the edge's gate. Work is sequenced edge by edge,
not file by file: the question before any implementation is "which edge does this land, and is
that edge's gate in place?"

Two orders follow, and they are different:

- **Descent** orders the *decisions*: prerequisites before dependents.
- **Per-edge** orders the *changes*: gate before implementation.

## Computing the order

The open set is the decisions the request leaves open — no more. Sort it:

1. A decision with **no open prerequisite** comes first. It is the top of the open sub-graph: all
   of its `depends_on` targets are settled, so its own decision can be stated without guessing.
2. Then its dependents, in dependency order (any topological order of the rest; depth or breadth
   does not matter, the edges do).
3. When several decisions are sources, the one **closest to the request's intent** goes first.
   State the tie-break and why; do not leave it implicit.

If the request settles a new rule, that rule is the top: place it as a node before descending.

Never descend past the open set. The scope is what the user named; a dependent that is not in it
is reported, not visited.

## The cycle

For each decision in that order:

1. **Structure.** The orchestrator places the nodes and `depends_on` edges the order needs, before
   their dependents (`deccy new --on ...` for new nodes, `deccy record` edits for rewired edges).
   The drafter does not run these verbs.
2. **Gate.** Confirm the evaluation(s) covering the edges this decision will use are already
   recorded and hash-frozen: criterion in words, test path if it has one. A missing or unfrozen
   gate stops the draft.
3. **Red.** For a test gate, run the already-authored gate against the base (the orchestrator says
   whether this is required). It must fail for the reason the decision names; quote the failure. A
   test that passes before the change is either already satisfied (cite it) or not testing the
   decision — report it, do not edit the gate.
4. **Green.** Implement until the frozen gates on the settled edges pass, changing nothing outside
   the decision's own refs and never touching the gate's paths.
5. **Prose.** Write the decision's node and rationale last: it states what the code now does, so
   it cannot precede it.

Then descend to the next dependent.

### New decision vs refined decision

The cycle reads differently depending on whether the decision itself is new:

- **New decision** — the decision node and its prose come first (the decision is the input), then
  its gate, then its dependents. Its prose is the decision, not a report on code.
- **Refined or implemented decision** — the gate comes first, then red, green, and the decision's
  prose last, as above. For a refine, the gate is reused or amended before the
  implementation; the draft is based at the existing target, and the landable set excludes the
  gate paths restored for running.

"Evaluation first" is always relative to the **implementation**, never to the decision the
evaluation is about.

## Per-form adaptation

Which form the gate takes is the evaluation matrix's call (`eval-matrix.md`). "Red" only exists
where the gate runs:

| Gate form | "First" means | "Green" means |
|---|---|---|
| test (code → code) | test authored and failing | test passes; nothing else changed |
| fidelity (natural → code) | the two-direction rule stated | artifact enforces exactly the prose, neither stricter nor looser |
| conformance (structured → code) | the requirement clause named | no clause looser or stricter |
| gate (natural → natural/structured) | criterion stated | criterion applied to the new text |
| review-criteria, checklist | criterion stated | applied at review |
| measurement | budget or baseline stated | measured after the change |

For a gate with no runnable check, say which form it takes and that there is nothing to run. Do
not invent a test to manufacture a red.

## What to report

- The order, before the first edit, in one line: `X → Y → Z`.
- The red failure, quoted, for every test gate.
- The green run, for every gate.
- Every deviation from the order, with why.
- Every edit's authorising node and edge.

Red is **session evidence, never graph state**: gates describe how the check is done (I5), and a
verdict stored in a node is a violation. Green is a run, not a field.

## Stop rules

- **Unsettled prerequisite** — stop and settle it (or ask). Do not encode a guess about it in a
  lower gate; groundedness forbids a gate that presupposes a decision that does not exist.
- **Edit with no owning node or edge** — stop. The decision is missing; place it first. An edge
  you would need but do not want to draw is an unresolved decision, not a licence to change code.
- **A test that passes before the change** — stop and say why. Either the behaviour already
  exists (cite the change) or the test does not exercise the decision.
- **Scope boundary** — stop at the set the user named. Report the next dependent; do not visit it.

## Worked example

Task: "only a request that names its tenant is admitted; every rejection frees its slot."

1. Top: the rule `<rule>` (no open prerequisite — the producers depend on it). Place it, prose
   and all; it is a new decision.
2. Its gate `<gate>` (review-criteria): the rule's edges to the request shape, the release path
   and the refusal case.
3. Descend: the producers `<producer-a>` and `<producer-b>` gain `depends_on: <rule>`, each with a
   covering gate.
4. Gate first: edit the gate criteria (`<criteria-a>`, `<criteria-b>`, `<criteria-c>`,
   `<criteria-d>`), record.
5. Red: three gates fail — the guard admits an unnamed request, the rejection path still holds the
   slot, the empty tenant still admits.
6. Green: the guard, the two call sites, the schema pattern, the type's doc.
7. Prose last: `<producer-a>`, `<producer-b>`, `<criteria-c>`, `<criteria-d>`, `<dependent-a>`,
   `<dependent-b>` rationales now describe the settled behaviour.
