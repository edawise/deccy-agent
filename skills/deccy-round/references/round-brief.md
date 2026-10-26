# Round brief template

The planner fills this in, read-only, and hands it to the user and orchestrator. One page. No
graph writes, no node content, no test implementation.

```markdown
# Round brief: <short title>

Base: <current change id / tip>
Cap: 5 open units (or "unlimited" if the user set max_open_units = 0)
Barrier: refuse | warn | off
Scope: <one sentence>
Out of scope: <explicit exclusions>

## Units (<= cap)

| # | Unit | Mode | Target | depends_on (ids or descriptions) | Gate | Owned paths | Alternatives |
|---|---|---|---|---|---|---|---|
| 1 | <decision> | new | <what it decides> | <prereq ids> | new / reuse E / amend E | <repo paths> | none |
| 2 | <decision> | refine `<existing id>` | <what changes> | <existing edges, unchanged unless stated> | reuse `<eval id>` / amend `<eval id>` | <node + refs> | A/B |

**Mode.** `new` creates one decision node. `refine` edits an existing node: the target id is
required, the node and its current `ref` files are the base, and the change must not carry a
different decision (that is `new`). A refine unit does not create a skeleton.

## Gates

For each edge the round will use:

- Edge: <dependent> -> <prerequisite>
- Evaluation: <existing id, or description for a new one>; `evaluates` = <dependent>;
  `depends_on` = <prerequisite>
- Mode: **new** | **reuse** the frozen evaluation | **amend** the existing evaluation
- If amend: why the existing gate no longer covers the use, and what changes
- Form: <test | fidelity | conformance | gate | review-criteria | measurement>
- Red command: `<command>` (must fail before implementation); for a review-criteria gate with no
  runnable red, write `none — weak gate; user must accept the advisory`
- Green condition: <what passing means>
- Test/criteria paths: <paths>
- Grounded in: <recorded decision/ref that makes the check decidable>
- Landing rule: gate paths are restored into a refine draft for running but are **not** part of
  the landable path set

## Order

1. <decision or gate> — why it comes first
2. ...

State the tie-break when several units are sources. A decision with no open prerequisite goes
before its dependents. A gate is authored and frozen before the dependent implementation.

## Alternatives

- <unit>: A = <approach>, B = <approach>; user chooses after judging. Both drafts base at the same
  base/gate — the frozen evaluation for a new unit, the existing target for a refine.

## Open questions / risks

- <unsettled prerequisite, ambiguous placement, missing edge, external dependency>
- <refine: whether the existing gate is still valid, or must be amended first>
- <refine: whether the change is actually a new decision (then split it)>

## Stop conditions

- <what would make the round stop rather than guess>
```

## Planner checks

Before returning the brief:

1. Every unit is one decision (I1) and every decision has a `depends_on` (I2).
2. Every evaluation has `evaluates` (I3); every decision→decision edge the round uses has a
   covering evaluation (I4).
3. Every gate is grounded in recorded decisions/refs, not in a guess about an unsettled
   prerequisite.
4. No unit edits another node’s `ref` file; ownership is explicit.
5. The unit count is within the cap; alternatives count as separate drafts but one unit.
6. Every refine unit names an existing target id, its current edges, and whether its gate is
   reused or amended. A refine that changes the decision into a different decision is split into a
   new node.
7. The red command actually distinguishes the base from the candidate: it must fail on the base
   and pass on the candidate. For a refine, “base” is the target’s current state; for a reused
   gate that already passes on the current state, say why the change is still gated (or amend the
   gate). If the gate intentionally has no base-red (a licence-only review criterion), mark it as a
   weak gate and put the user’s explicit acceptance in the brief; the judge will report `gate-weak`,
   not reject the candidate.
8. The user has a real choice, not a rubber stamp: alternatives, risk, or scope.

## What the planner never writes

No `deccy new`, no `deccy record`, no node JSON, no test files, no workspace. The brief names the
work; the orchestrator creates it and the role agents do it.
