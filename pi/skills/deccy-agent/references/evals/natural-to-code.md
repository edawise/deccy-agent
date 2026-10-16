# natural-to-code — fidelity

A tool-checkable artifact (schema, source) is derived from a prose prerequisite.

## The check

1. Necessity: the prose leaves something only a machine-checkable artifact can settle —
   what counts as conforming. Fail if the artifact could be dropped without loss.
2. Fidelity, both directions: the artifact enforces exactly what the prose claims — no
   stricter, no looser, nothing smuggled in. Fail on divergence in either direction; name
   the diverging rule.

## Forbidden

- Interpreting the prose into new requirements; the artifact translates, it does not
  decide.
- One-directional checks — loose and strict divergences both fail.
- Behavior beyond conformance: the artifact's shape is in question, not its running.

## Why this much

Prose drifts; artifacts do not. Fidelity pins the two together so "valid" means the same
thing to human and tool readers alike.
