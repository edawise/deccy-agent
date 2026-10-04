# Decision placement

Decide *which node(s)* a piece of work belongs in before touching anything. The skill's section 4
is the summary; this file is the full procedure.

## Identify the decisions, including level

A request usually carries decisions at more than one level: a higher-order decision ("add rate
limiting to the API") elaborated by lower-level decisions (individual requirements, mechanism
choices) that each record finer-grained reasoning. Higher and lower levels each get their own
nodes, with the lower depending on the higher. See the elaboration example below.

## Match work to decision

A decision is **one commitment**. Signals that two things are two commitments rather than one:
they rely on different dependency neighborhoods, they would change for different reasons or at
different times, or one states a requirement and the other its mechanism. These are defeasible
signals, not thresholds — split when they point to genuinely separate reasoning, keep together
when they do not.

**Premises are checked, not assumed.** A decision records a commitment; its reasoning rests on
claims about how things are — substrate behavior, existing contents, external contracts, others'
requirements. Verify each premise at its source before recording. Where the subject's real
granularity differs from the assumed one, the decision addresses the difference rather than
papering over it.

1. **The work changes what an existing node decided → edit that node** (record flow,
   `deccy-workflow.md`). Adding a second node that says nearly the same thing splits one decision
   across two changes (violates I1).
2. **The work is a new decision → new node in a new change**, positioned after its dependencies
   (`deccy new -m <summary> --on <dep>`), with `depends_on` naming them. Never fold a new decision into an existing
   node's change, even when the code lives in the same files. This is the central failure mode:
   reaching for the code (or the node whose `ref` covers it) and stuffing a different decision in.
3. **The work touches files listed in another node's `ref` → you are changing that node's
   decision.** Either the touch serves that decision (squash it into the node) or it serves a
   different purpose (new decision, new node). When unsure, new node.
4. **A check (test, criterion, measurement) → evaluation node**, wired per I4
   (`evaluation-conventions.md`).

## Splitting a bundled node

A node holding two commitments is an I1 violation, not a style preference: one
change carries two decisions, so neither can be depended on or evaluated
separately. The signals in "Match work to decision" above diagnose it — split
when they point to genuinely separate reasoning. Procedure:

1. Create the split-out decision as a **new node** in a new change after the
   shared parent (`deccy new -m <summary> --on <parent>`), with `depends_on` naming that parent.
2. Trim the original node to what remains via a `deccy record` edit (edit the
   node file in the working copy, then `deccy record nodes/<id>.json --to <id>`).
   Never delete-and-recreate: the original change id is
   referenced by existing edges.
3. Rewire each dependent's `depends_on` to the parent its reasoning actually uses
   (`deccy record` edits, one node at a time).
4. Cover every new or rewired decision edge with a sandwich evaluation
   (`evaluates` ∋ dependent, `depends_on` ∋ prerequisite), and re-scope or
   split any existing gate whose subject has narrowed.

Merges and re-parenting follow the same shape in reverse: the surviving node
absorbs the content by a `deccy record` edit, the vacated node is removed with
`deccy remove` (it takes its own gates), and dependents rewire as in step 3.

## Topological order after edge changes

`deccy new --on` positions a new node after the unique head of its dependency set, so every new
node is topologically safe by construction. A `depends_on` **rewire** of an existing node is not:
pointing it at a prerequisite that sits after it in history leaves that prerequisite newer than
its dependent. The graph still reads correctly — navigation ignores parentage — but history stops
telling the dependency story, and `deccy new --on` positioning starts from the wrong place.

The `deccy` CLI has no rebase verb, so a rewire that inverts the order is fixed outside it. After
adding any `depends_on` edge, new node or rewire, check that every prerequisite precedes its
dependent (`evaluates` targets count as prerequisites for ordering — a check follows what it
checks):

```sh
scripts/check-topology.py      # every prerequisite precedes its dependent (read-only)
# or, by hand (newest first; every id named in depends_on/evaluates must appear below its user):
jj log -r '::@' --no-graph -T 'change_id.shortest(8) ++ "\n"'
```

A report naming a prerequisite newer than its dependent is fixed by moving that prerequisite
**below** its dependents — and the cheapest fix is not to need one:

- **Place by construction.** `deccy new` positions the new node after the *newest* id in its `--on`
  set. So when the new node is one that nodes already in the graph will have to depend on, name a
  dependency that sits below those dependents: the node then lands below them too and no rebase is
  needed. (Worked case: a rule that a node near the top of the stack must depend on — naming a
  dependency far below it lands the rule just below that dependency and below every dependent.)
- **Otherwise move the one node**, with the checker as the judge:

```sh
jj rebase -r <prereq> -A <the change it should follow>   # moves that node
scripts/check-topology.py                                # the oracle
```

Do **not** use `jj rebase -s <prereq> -B <dependent>`. In a linear stack `-s` takes the
prerequisite's whole subtree — every change newer than it — and drags it along, reordering those
changes against the dependent and inverting edges you were not looking at. A revset block
(`jj rebase -r '<a>::<b>' -A <dest>`) is no better: when the block already sits above the
destination, it is a no-op.

Re-check after any move. Change ids survive it, so node filenames and edges are untouched.

## Elaboration, worked

Request: "add rate limiting to the API".

Naive (wrong): one change touching `src/api/*`, with a single node whose rationale argues the
whole thing at once — the decision to rate-limit, the 429 contract, and the token-bucket
mechanism all in one place. The higher-order decision and its elaboration are collapsed together,
so nothing can depend on or evaluate the levels separately.

Elaborated:

- `R` (decision): "the API rate-limits clients" — the higher-order decision.
  `content.type: "text"`, `ref: "inline"`, rationale: "the API is shared and unauthenticated;
  without limits one client can starve the rest". `depends_on: [zzzzzzzz]` (or the relevant
  parent).
- `R1` (decision): "excess requests get 429; legitimate bursts up to N succeed".
  `content.type: "ears"`, `ref: "inline"`, `depends_on: [R]`.
- `R2` (decision): "enforcement is a token bucket, 100 req/min per IP, in middleware".
  `content.type: "text"`, `ref: ["src/api/rate-limit.ts"]`, rationale: "token bucket absorbs
  bursts where fixed-window would 429 them; middleware keeps it off every handler".
  `depends_on: [R, R1]`.
- `E` (evaluation): `content.type: "test"`, `ref: ["tests/rate-limit.spec.ts"]`, rationale:
  "burst-then-sustain traffic gets 429s exactly past the budget", `evaluates: [R2]`,
  `depends_on: [R1]` — covers edge `R2 → R1`. Further evals cover `R1 → R` and `R2 → R` as the
  graph grows.

## Smells

- Rationale text in node X arguing a different decision than X records → a decision is sitting in
  the wrong node; move it out and link it.
- Code changed but no node created or edited → the choice is undocumented; find or create its node.
- A `depends_on` edge added with no covering evaluation → add one (I4).
- Edges pointing at nodes by description ("the rate-limit change") instead of change id → resolve
  the id with `deccy log` first.
- A prerequisite positioned after its dependent in history → move that prerequisite below its
  dependents (`jj rebase -r <prereq> -A …`) and re-check (topological order above); better, place
  new nodes so it cannot happen.
