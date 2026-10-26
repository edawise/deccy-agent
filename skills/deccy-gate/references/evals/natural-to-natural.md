# natural-to-natural — gate

A prose dependent uses a prose prerequisite. This is the base form every gate cell reuses.

## The check

This check is copied verbatim as the evaluation criterion. It runs at check time
against the two recorded nodes; naming happens in the check's output, never in
the criterion:

1. License: no element of the dependent contradicts the prerequisite. Fail on any
   contradicting element — name the element.

## Forbidden

- Defining the dependent: no scope definitions, no "exactly X, fail if anything else".
- Rules the prerequisite does not state: vocabulary standards, justification tests,
  traceability demands.
- Behavior probes — those belong to cells whose child is code.
- Wording echoes of the dependent; the criterion must survive rewording of the dependent.
- Pre-naming elements: neither child-derived phrasing nor a chosen parent element. Which
  element is at issue is what the check discovers at check time; baking either into the
  criterion assumes the dependent's use and breaks under rewording or rescoping.

## Why this much

The check answers one question: is the dependent's use of the prerequisite sound? It
exists so no use goes ungated. Anything beyond that is a second decision, and decisions
belong in nodes.
