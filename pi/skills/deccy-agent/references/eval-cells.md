# Evaluation cells

Per-cell guidance for the matrix in `evaluations.md`. One section per cell that carries an edge;
open the section for the cell the edge falls in. Sections are ordered by rising strictness.

The shared prohibition (`evaluations.md`) holds in every cell: an evaluation never defines its
subject. A cell's Forbidden section adds detail to it; it never relaxes it.

## natural-to-natural — gate

A prose dependent uses a prose prerequisite. This is the base form every gate cell reuses.

### The check

This check is copied verbatim as the evaluation criterion. It runs at check time against the two
recorded nodes; naming happens in the check's output, never in the criterion:

1. License: no element of the dependent contradicts the prerequisite. Fail on any contradicting
   element — name the element.

### Forbidden

- Defining the dependent (the shared prohibition) — concretely: no scope definitions, no "exactly
  X, fail if anything else".
- Rules the prerequisite does not state: vocabulary standards, justification tests, traceability
  demands.
- Behavior probes — those belong to cells whose child is code.
- Wording echoes of the dependent; the criterion must survive rewording of the dependent.
- Pre-naming elements: neither child-derived phrasing nor a chosen parent element. Which element is
  at issue is what the check discovers at check time; baking either into the criterion assumes the
  dependent's use and breaks under rewording or rescoping.

### Why this much

The check answers one question: is the dependent's use of the prerequisite sound? It exists so no
use goes ungated. Anything beyond that is a second decision, and decisions belong in nodes.

## natural-to-structured — gate

A constrained-notation dependent (requirement sentence, diagram) elaborates a prose prerequisite.

### The check

The base check above applies to the elaboration — its criterion is copied verbatim the same way;
findings name elements at check time:

1. License: no element of the elaboration contradicts the parent. Fail on any contradicting element
   — name the element.

### Forbidden

The base form's prohibitions apply, plus: structured notation buys no license to demand
observables. A requirement sentence is still words; its gate is still non-violation.

### Why this much

Elaboration narrows a parent without becoming implementable. The gate keeps the elaboration honest
to the parent; whether it is met is decided further down, where the child is code.

## natural-to-code — fidelity

A tool-checkable artifact (schema, source) is derived from a prose prerequisite.

### The check

1. Necessity: the prose leaves something only a machine-checkable artifact can settle — what counts
   as conforming. Fail if the artifact could be dropped without loss.
2. Fidelity, both directions: the artifact enforces exactly what the prose claims — no stricter, no
   looser, nothing smuggled in. Fail on divergence in either direction; name the diverging rule.

### Forbidden

- Interpreting the prose into new requirements; the artifact translates, it does not decide.
- One-directional checks — loose and strict divergences both fail.
- Behavior beyond conformance: the artifact's shape is in question, not its running.

### Why this much

Prose drifts; artifacts do not. Fidelity pins the two together so "valid" means the same thing to
human and tool readers alike.

## structured-to-code — conformance

An implementation artifact answers to a structured requirement.

### The check

1. Necessity: the artifact exists to meet the requirement; fail if the edge could be dropped
   without loss.
2. Conformance: state observables — what running the artifact must show for the requirement to hold.
   Acceptance criteria, commands, probe scripts belong here and seed executable tests when a harness
   exists.

### Forbidden

- Redefining the requirement; criteria reference the requirement's promise, never its sentences.
- Requirements the structured parent does not state.
- Intent language ("should feel", "must be elegant") — observables only.
- Verdicts: describe how the check runs, never its outcome.

### Why this much

This is the first cell where behavior may be demanded, because behavior finally exists.

## code-to-code — test

An artifact-bearing node uses an artifact-bearing prerequisite. Three edges live here:

1. **Implementation to implementation** — the dependent's artifact must honor the prerequisite's
   artifact's contract (APIs, schemas, protocols).
2. **Adoption** — a decision names an evaluation in `depends_on` ("this implementation adopts this
   suite as its gate"); the artifact must really satisfy the suite.
3. **Eval chains** — a suite's use of what it checks is sound (`evaluates` targeting an evaluation).
   Rare; use only when the check is load-bearing enough to need a check.

### The check

1. Necessity: name what the dependent artifact is for, given the prerequisite. Fail if the edge can
   be dropped without loss.
2. Contract: state the observables — what running the dependent's artifacts must show against the
   prerequisite's contract. `ref` points at runnable checks: test files, commands, benchmarks.
   Assertions exact. Describe how the check runs, never what it concluded: evaluations record
   methods, not outcomes.

### Forbidden

- Behavior the prerequisite's artifacts do not imply.
- Human-judgment criteria; if a check cannot run mechanically, it is not this cell.
- Re-checking the contract itself — the prerequisite's artifacts define it.

### Why this much

Both sides are executable, so the gate can be executed: this is the only cell where the sandwich is
a machine verdict waiting to happen.
