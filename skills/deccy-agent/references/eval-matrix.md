# Evaluation matrix

An evaluation gates one edge: the dependent (child) uses the prerequisite (parent). Which
form the evaluation takes is decided by the two content layers involved — nothing else.

## The three layers

A layer is read from what the node carries — inline or ref, never both (the node schema
enforces it):

- `ref: "inline"` — the layer of the inline content's form.
- `ref` paths — the layer of the ref'd artifacts (source, schemas and tests are code;
  spec documents read as their own form).

So a prose-labelled node whose ref points at source is code-layer: its gate may demand
observables. Layer definitions:

- **natural** — readable prose. The evaluator can only read it; judgments are human.
- **structured** — constrained notation with a fixed grammar (requirement sentences,
  diagrams, tables). The evaluator can parse and pattern-check it; meaning stays human.
- **code** — tool-checkable artifact (schema, source, tests). The evaluator can run
  checks against it mechanically.

An artifact that is none of these introduces a new layer: add a row and column here and
one guidance file per new cell that carries an edge. Until then, use the default cell.

## Cells

Rows are the parent's layer, columns the child's. "X-to-Y" = a Y child using an X parent.

| parent \ child | natural | structured | code |
|---|---|---|---|
| natural | gate — `evals/natural-to-natural.md` | gate — `evals/natural-to-structured.md` | fidelity — `evals/natural-to-code.md` |
| structured | default | default | conformance — `evals/structured-to-code.md` |
| code | default | default | test — `evals/code-to-code.md` |

default: the gate form (`evals/natural-to-natural.md`) plus a flag to extend this matrix.

## The strictness rule

Children of natural or structured layers are commitments in words: an evaluation over them
checks non-violation and never demands behavior. Children of the code layer are
artifacts: an evaluation over them checks observables and never judges intent. Strictness
rises with the child's layer and sharpens with the parent's — there is no level counting
and no "higher is looser" heuristic to drift.

In every cell: the evaluation never defines its subject. It invents no rule its
prerequisite does not state, restates no dependent, and tracks no wording.
