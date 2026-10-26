# Evaluation conventions

Evaluations are heavily present: every `depends_on` edge between decisions is covered by ≥1
evaluation. This file defines what evaluation nodes look like and how coverage works.

## What an evaluation node contains

`content.type` names the check kind; `content.ref` points at the artifact that performs or states
the check; `content.rationale` says why this check is the right gate. The node describes **how the
check is done** — never an outcome or verdict. Elements a check names when it fails are
findings: check output, never recorded in advance in the criterion. Typical types:

| `content.type` | `ref` points at | Example rationale |
|---|---|---|
| `test` | test files/commands | "exercises both colour schemes on every themed surface" |
| `review-criteria` | inline checklist, or a spec/doc path | "merge requires two approvals against these criteria" |
| `checklist` | inline steps | "manual pass over the migration before release" |
| `measurement` | benchmark/script path | "p99 latency stays under budget on the hot path" |

New types are fine; keep them open (the schema permits any `type`). Keep `ref: "inline"` with an
embedded `content` field only for criteria small enough to live in the node.

## Gate properties

Two properties hold for every evaluation regardless of check kind:

- **Independence.** A gate checks *properties* of its subject, not the subject's wording,
  and names nothing endpoint-specific in advance. Acceptance test: rewriting the evaluated
  node without changing what it decides leaves the gate intact. Specificity (which element
  failed) appears only in the check's output, never in the recorded criterion.
- **Groundedness.** Gate criteria are decidable against what is recorded. They may constrain the
  evaluated subject and its recorded prerequisites and state properties checkable over time; they
  may not presuppose decisions that do not exist yet.

## The sandwich (I4)

For a `depends_on` edge `A → B` between decisions, the covering evaluation `E` has:

```json
{
  "kind": "evaluation",
  "evaluates": ["<A-change-id>"],
  "depends_on": ["<B-change-id>"],
  "content": { "type": "test", "ref": ["tests/..."], "rationale": "..." }
}
```

The evaluation checks that *A's use of B is sound*: it evaluates the dependent `A` in the context
of the prerequisite `B`. The direct edge `A.depends_on ∋ B` stays — the evaluation is additional
coverage, not a replacement.

## Choosing the evaluation's form

Before writing an evaluation, place both endpoints of the edge on the layer ladder by what
their content *is* — readable prose, constrained notation, or tool-checkable artifact —
open the matching cell in `eval-matrix.md`, and follow its file. An unknown cell takes the
gate form and gets flagged for a matrix entry.

All forms share one prohibition: an evaluation never defines its subject. It invents no
rule its prerequisite does not state, restates no dependent, and tracks no dependent's
wording.

## Coverage shapes

- **One edge, one eval** (common): `E.evaluates = [A]`, `E.depends_on = [B]`.
- **Fan-out** — `A` depends on several prerequisites `B1..Bn`: one eval may cover all of them
  (`evaluates: [A]`, `depends_on: [B1, B2]`), or one eval per edge when the checks genuinely differ.
  Prefer fewer, broader evals when a single test/criterion checks the whole use; split when the
  checks are independent.
- **Fan-in** — several dependents use the same `B`: each dependent edge needs its own coverage;
  one eval may still cover several (`evaluates: [A1, A2]`, `depends_on: [B]`) if a single check
  genuinely gates both uses.
- **Eval chains**: an evaluation may itself be evaluated (`evaluates` targeting an evaluation).
  Rare; use only when the check itself is load-bearing enough to need a check.

## When to write the eval

Write the evaluation in the same unit of work as the edge it covers — ideally the same session,
immediately after creating the edge. An uncovered edge is an invariant violation (I4); do not leave
one behind "for later". If the check cannot be implemented yet (e.g. test needs infra), write the
evaluation node anyway with `type: "review-criteria"` or `"checklist"` describing the intended
check, so coverage exists and the gap is explicit.
