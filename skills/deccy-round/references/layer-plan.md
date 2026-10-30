# Layer plan template

The planner fills this in from the recorded graph and hands it to the user and the orchestrator.
It is **breadth only**: one row per node the layer needs. No gate design, no red commands, no
alternatives, no per-unit prose. The one path cell per row exists so components can be partitioned
safely; it is not a full ownership inventory.

```markdown
# Layer plan: <short title>

Base: <current change id / tip>
Seeds: <id> <label>, <id> <label>       # the recorded decisions this layer elaborates
Scope: <one sentence>
Out of scope: <ids or topics>

| #  | act         | decision (one commitment) | on              | gate         | writes            | fork      | licensed by     |
|----|-------------|---------------------------|-----------------|--------------|-------------------|-----------|-----------------|
| U1 | new         | <one sentence, one verb>  | <ids / handles> | new          | <paths / prefix>  | —         | <id> "<clause>" |
| U2 | new         | ...                       | U1              | new          | <paths>           | —         | U1              |
| U3 | refine <id> | ...                       | existing        | reuse <id>   | <paths>           | —         | <id>            |
| U4 | new         | ...                       | U1, <landed id> | new          | <paths>           | A … / B … | <id>            |

Open questions: <...>
Stop conditions: <...>
```

## Columns

- **#** — a local handle (`U1`, `U2`, …). Handles are resolved to change ids by the orchestrator's
  skeleton pass. They are not node ids and never enter the graph.
- **act** — `new` (one new decision node) or `refine <existing id>` (an edit to an existing
  decision). A refine edits the target's node and refs; it creates no skeleton. If the change needs
  a different commitment, a new `depends_on` edge or a new node, it is `new`.
- **decision** — the commitment in one sentence, one verb, no "and". Two commitments are two rows.
- **on** — prerequisites: recorded node ids, or handles of rows earlier in this plan. Every `new`
  decision needs at least one (I2). A `refine` row writes `existing`.
- **gate** — the default is `new`: one evaluation node per new decision, `depends_on` = the row's
  `on` set, `evaluates` = the row. That makes I4 coverage structural instead of a per-edge
  judgement. Use `reuse <eval id>` only when an existing evaluation covers every edge the row adds;
  use `amend <eval id>` for a refine whose evaluation must change. Gate form and the red command
  are the gate author's, derived from the evaluation matrix — never the planner's.
- **writes** — the repo paths this unit may write: the decision's `ref` files plus the new gate's
  test/criteria paths. The unit's own node file is implicit. Use a directory prefix when the unit
  owns a whole area, or when the exact test path depends on the gate form the author has not chosen
  yet; the author must stay inside it. Two rows may not list the same path unless one is an ancestor
  of the other in the plan. A gate author or drafter that needs a path outside this set stops and
  returns it as a plan change.
- **fork** — a choice that changes the content of the units that depend on this one (`A …` / `B …`,
  one line each). A fork is **not** an implementation alternative (two drafts of one unit); those
  are chosen after judging and never appear here. A forked row with no chosen branch cannot have
  dependants in this layer: all skeletons are created before any workspace opens, and a second
  skeleton pass would reparent open workspaces. Resolve the fork in the plan, or move its
  dependants to the next layer.
- **licensed by** — the recorded clause this row elaborates: a node id and a short quote, or an
  earlier handle. A row with no licence is a wish; leave it out.

## Checks before returning

1. Every row is one commitment, and every `new` row has at least one `on` (I1, I2).
2. Every `new` row has `gate: new`, or names the existing evaluation that covers every edge it
   adds. I3 and I4 then follow from the skeleton pass.
3. Every `on` resolves: a recorded id or an earlier handle. No forward references, no cycles.
4. Every `refine` target exists and appears once. A refine never targets a node this plan creates.
5. Every row is licensed by a recorded clause or an earlier row.
6. No row depends on an unresolved fork. Drop its dependants from this layer instead.
7. Every `writes` set is disjoint from every other row's, except along an `on` chain. Two units that
   need one path must be ordered by `on`; do not put them in parallel components.
8. Handles are unique and stable.
9. The layer is within `max_units_per_layer` (default 12; `0` unlimited). Larger layers split: the
   skeleton pass is one linear stack, and every record rebases every workspace above it.

## Stop conditions

- A needed decision is not licensed by anything recorded — stop and ask; do not invent it.
- A row needs a decision outside the seeds or scope — report it as the next layer's seed.
- An existing node would need a new edge to make the layer work — that is a refine of that node,
  not a dependency; stop and plan it as a row.
- A fork cannot be resolved now and its dependants are required for the layer — stop.
- A refine target turns out to carry a different commitment — split it into a `new` row.
- The plan exceeds `max_units_per_layer` after deduplication — split it into layers.

## What the planner never writes

No `deccy new`, no `deccy record`, no node JSON, no evaluation, no test, no workspace, and no
ownership inventory beyond the row's `writes` cell. The layer plan names the nodes; the orchestrator
creates them, the gate author derives the checks, and the drafter writes the decision.
