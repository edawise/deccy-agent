# structured-to-code — conformance

An implementation artifact answers to a structured requirement.

## The check

1. Necessity: the artifact exists to meet the requirement; fail if the edge could be
   dropped without loss.
2. Conformance: state observables — what running the artifact must show for the
   requirement to hold. Acceptance criteria, commands, probe scripts belong here and seed
   executable tests when a harness exists.

## Forbidden

- Redefining the requirement; criteria reference the requirement's promise, never its
  sentences.
- Requirements the structured parent does not state.
- Intent language ("should feel", "must be elegant") — observables only.
- Verdicts: describe how the check runs, never its outcome.

## Why this much

This is the first cell where behavior may be demanded, because behavior finally exists.
