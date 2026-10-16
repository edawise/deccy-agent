# code-to-code — test

An artifact-bearing node uses an artifact-bearing prerequisite. Three edges live here:

1. **Implementation to implementation** — the dependent's artifact must honor the
   prerequisite's artifact's contract (APIs, schemas, protocols).
2. **Adoption** — a decision names an evaluation in `depends_on` ("this implementation
   adopts this suite as its gate"); the artifact must really satisfy the suite.
3. **Eval chains** — a suite's use of what it checks is sound (`evaluates` targeting an
   evaluation). Rare; use only when the check is load-bearing enough to need a check.

## The check

1. Necessity: name what the dependent artifact is for, given the prerequisite. Fail if
   the edge can be dropped without loss.
2. Contract: state the observables — what running the dependent's artifacts must show
   against the prerequisite's contract. `ref` points at runnable checks: test files,
   commands, benchmarks. Assertions exact. Describe how the check runs, never what it
   concluded: evaluations record methods, not outcomes.

## Forbidden

- Behavior the prerequisite's artifacts do not imply.
- Human-judgment criteria; if a check cannot run mechanically, it is not this cell.
- Re-checking the contract itself — the prerequisite's artifacts define it.

## Why this much

Both sides are executable, so the gate can be executed: this is the only cell where the
sandwich is a machine verdict waiting to happen.
