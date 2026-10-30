# Adversarial review protocol

The judge exists because a drafter cannot be trusted to attest its own gate. The judge gets the
frozen gate, the candidate draft, and a clean room; it runs the checks itself and reports. This
file is the evidence standard.

## Why clean-room

The drafter’s workspace contains the drafter’s runs, environment changes and possibly edits to the
gate. Running the gate there proves only that the drafter’s workspace passes. The judge creates
workspaces **at the decision node** and applies the gate and the candidate itself:

```text
base workspace:       decision node + gate paths            -> must be red
candidate workspace:  decision node + gate paths + draft     -> must be green
```

The decision node is the base. The gate paths belong to the evaluation node and are restored from
`$EVAL_ID`; the candidate paths are restored from `$DRAFT`. Nothing else is copied.

## Refine candidates

A refine edits an existing decision. The clean-room shape is the same, with three differences:

- the base is the **existing target’s current state**, not a new decision skeleton;
- the candidate paths are the **landable** set (target node + refs), not the raw draft diff; the
  drafter’s workspace also contains gate paths restored for running, and those are not candidate
  edits;
- if the gate was **amended or newly created for the refine**, the hash must be the new frozen
  hash; any verdict based on the old gate is void.

Restore the gate paths from `$EVAL_ID` into both base and candidate. Restore only `$DRAFT_PATHS`
(landable) from the draft into the candidate. If the draft’s landable set contains a gate path, the
draft edited or is trying to land the gate: **gate integrity: broken**. If a reused gate already
passes on the target’s current state and the refine is meant to change behavior, the gate is not
red; report **gate strength: weak** and let the user decide (or the gate author amend), unless the
change is already satisfied.

## Gate integrity

Before believing a green run:

1. **Hash.** Recompute the gate hash from `$EVAL_ID` and compare to the orchestrator’s frozen
   hash. Content hashed: the evaluation node file and every path in `$GATE_PATHS`.
2. **No gate edits.** `$DRAFT_PATHS` must be disjoint from `$GATE_PATHS`. If the draft changed the
   gate, the candidate is out; verdict **gate-integrity**.
3. **Same command.** Run the exact red/green command from the gate; do not substitute a more
   convenient command.
4. **Same subject.** The candidate paths must be the decision’s ownership, not another node’s ref
   files. A candidate that passes by changing a prerequisite is not a candidate.

## Base-red

Run the red command on the decision node plus the gate, with no candidate. It must fail for the
reason the gate names.

- Fail from a syntax error in the test, a missing **unrelated** fixture, or an unrelated
  environment problem: **inconclusive** (the gate is testing the harness, not the use); report what
  is broken.
- Fail because the decision’s own module/interface is absent: valid **interface red** if the
  candidate supplies it and the same check turns green. The failure must name that interface.
- Pass: **gate strength: weak** (the gate is already satisfied or vacuous). Record it and continue
  to the candidate; this is advisory, not a candidate rejection.
- Fail with the intended assertion: red is valid; continue.

If the decision node is a placeholder skeleton, base-red may fail because the placeholder is not a
real implementation. That is acceptable only if the gate’s assertion is reached and fails for the
missing behaviour; otherwise record **gate strength: weak** or **inconclusive** and let the user
decide.

## Candidate-green

Run the green command on the decision node plus the gate plus the candidate. It must pass.

- Fail: **reject**; quote the failure.
- Pass but the gate was changed: **gate-integrity**.
- Pass but a counterexample shows the gate misses an obvious wrong behavior:
  **gate strength: weak** with the counterexample; the candidate remains accepted, and the user
  decides whether to accept the weak gate.
- Pass and the gate is intact: continue.

## Counterexamples and mutations

The gate run is necessary, not sufficient. Try at least one of:

- **Mutation:** change one line of the candidate to a plausible wrong behavior; the gate should
  fail. Restore the candidate after (the judge workspace is disposable).
- **Negative case:** the boundary the decision says must be rejected; it should be rejected.
- **Base copy:** use the base content instead of the candidate; the gate should be red. This
  catches a vacuous gate.
- **Alternative implementation:** for a review gate, write a counterexample in prose that satisfies
  the criterion but violates the decision’s use; if the criterion accepts it, report
  **gate strength: weak**.
- **Groundedness:** point at a rule the gate enforces that the decision/prerequisite does not
  state; if found, report **gate strength: weak** (ungrounded).

A gate that catches the intended failure but accepts every wrong mutation is weak; report it as
**gate-weak**, with the mutation. A judge is not required to prove the gate complete, but it must
report an obviously weak one. It does not veto the candidate on that basis.

## Independence and groundedness audit

- **Independence:** rewrite the decision in your head without changing what it decides. Does the
  gate still apply? If the gate names a function, file, endpoint or wording the decision does not
  require, it is too specific.
- **Groundedness:** every rule the gate enforces is stated in the evaluated decision or its
  recorded prerequisites. A gate that presupposes an unrecorded decision is ungrounded.
- **No verdict in the node (I5):** the evaluation describes the check, not “currently failing” or
  “passed on candidate”. If it records a verdict, that is a gate-integrity finding (an invalid
  gate), not a weak-gate advisory.

## Alternatives

Judge each candidate independently against the same frozen gate:

- do not compare candidates until each has a verdict;
- do not let a stronger alternative excuse a weak one;
- do not merge candidates; the user chooses;
- report per-candidate evidence in the same format.

## Evidence standard

Quote commands and outputs. “Tests pass” is not evidence; the command, the relevant output and the
gate hash are. If output is long, quote the failing/passing assertion and the exit status, and
keep the full log in the judge workspace.

Never write the verdict into a node. The graph records the check; the round report records the
verdict (I5).

## Verdict decision table

| Base | Candidate | Gate integrity | Counterexample | Verdict | Gate strength |
|---|---|---|---|---|---|
| red for the use | green | intact | none | accept | sound |
| red for the use | red | intact | — | reject | — |
| red for the use | green | broken | — | gate-integrity | — |
| passes | green | intact | — | accept | weak (no base-red) |
| passes | red | intact | — | reject | weak |
| red for the use | green | intact | obvious wrong candidate passes | accept | weak |
| crashes/unrelated | — | — | — | inconclusive | — |
| cannot run | — | — | — | inconclusive | — |

`gate-integrity` and `inconclusive` block. `gate-weak` is the `Gate strength` column, not a verdict:
the candidate is still accepted if it passes, and the user decides whether to accept the weak gate
or return it to the gate author.

“Inconclusive” is not a soft accept. The orchestrator must fix the environment or the gate and
re-judge.
