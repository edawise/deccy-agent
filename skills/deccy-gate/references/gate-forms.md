# Gate-author procedure

A gate is the evaluation node covering one use: the dependent `A` relies on prerequisite `B`.
The gate is `E` with `E.evaluates ∋ A` and `E.depends_on ∋ B`. It checks that **A’s use of B is
sound**, not that A restates B.

## 1. Read the use

```sh
deccy show <decision-id>
deccy show <prerequisite-id>
```

Name the use in one sentence: “A relies on B for ___.” If you cannot name it, the edge is not
ready to gate. Stop and report an unsettled prerequisite.

Check that the decision really exists and the edge is intended. A gate for a decision that does
not exist is ungrounded; a gate for an edge the plan does not draw is scope creep.

## 2. Choose the form

Read `eval-matrix.md`. Place each endpoint on the layer ladder by what its content **is**:

- **natural** — readable prose;
- **structured** — constrained notation (requirement sentences, diagrams, tables);
- **code** — tool-checkable artifact (source, schema, tests).

The row is the prerequisite’s layer, the column the dependent’s. Open the matching file in
`evals/`; the default cell is the gate form plus a flag to extend the matrix. Do not choose a form
because a test is convenient; choose it because of the layers.

## 3. Write the evaluation document

```json
{
  "kind": "evaluation",
  "evaluates": ["<decision-change-id>"],
  "depends_on": ["<prerequisite-change-id>"],
  "content": {
    "type": "test",
    "ref": ["tests/<edge>.spec.ts"],
    "rationale": "why this check is the right gate for this use"
  }
}
```

- `content.type` names the check: `test`, `review-criteria`, `checklist`, `measurement`, and so on.
- `content.ref` is `inline` with a small criterion in `content.content`, or a list of paths that
  carry the check.
- The rationale says why this check, not what the result was.
- No verdict, no “currently failing”, no session evidence (I5).

If the evaluation node was created as a decision skeleton, change `kind` to `evaluation`, add
`evaluates`, and set `depends_on` to the prerequisite. Keep the change id.

## 4. Write the check

### test (code → code)

Write the test at the path you listed. It must:

- exercise the **use** A makes of B, not A’s internal wording;
- fail on the prerequisite alone for the intended reason;
- pass on a correct implementation without special-casing the candidate;
- avoid asserting an implementation detail the decision does not require.

Run it red in the gate workspace:

```sh
cd "$WS"
<test command>
```

Quote the command and the failing assertion. A syntax error in the test or an unrelated fixture
failure is not red; fix the test harness first. A missing module/interface that the decision
introduces is a valid **interface red** only if the candidate supplies it and the test then passes;
name it explicitly. If the test passes, either the behaviour already exists (cite it) or the test is
not testing the decision. Stop.

### gate (natural → natural/structured)

Write the criterion, not a test. It must be decidable by a reviewer reading the dependent and the
prerequisite: e.g. “every clause in A’s requirement is permitted by B; A adds no rule B does not
state.” State it in the evaluation node; there is nothing to run. Red means the criterion is not
yet satisfied by the prerequisite alone (or is not applicable until A exists); say which.

### fidelity (natural → code)

State the two-direction rule: the artifact enforces exactly the prose, neither stricter nor
looser. The check is a review of the artifact against the prose; no test is required. The gate is
red before the artifact exists because the prose is unenforced; say that explicitly.

### conformance (structured → code)

Name the clause(s) the artifact must conform to. The check is clause-by-clause; red before the
artifact exists. Do not demand behavior the structured prerequisite does not state.

### review-criteria / checklist

Write the criteria as a short inline list or a referenced document. Red is not a command; say that
the criterion is not yet met because the implementation is absent and how a reviewer applies it.

### measurement

State the budget or baseline and the measurement procedure. Red is the baseline measurement (or
“no implementation to measure”); green is within budget after the change. Do not invent a budget
the decision does not name.

## 5. Independence and groundedness

Acceptance test for independence: rewrite the decision without changing what it decides. The gate
should still apply unchanged. If the gate names a function, file, endpoint, or wording that the
decision does not require, it is too specific; move specificity into the check’s output, not the
recorded criterion.

Groundedness: every rule the gate enforces must be stated by the decision or its recorded
prerequisites. The gate may constrain the subject and its recorded prerequisites; it may not
presuppose a decision that does not exist yet. If the implementation needs an unsettled
prerequisite, stop; the round must settle it first.

## 6. Amending or adding a refine gate

A refine may reuse its evaluation, amend it, or add a new evaluation for an edge it adds. Amend when
the old gate no longer covers the use, the decision’s behavior changed, or the old gate was too
weak.

- Open the gate draft at the **existing evaluation**; edit the evaluation document and its tests in
  place. Keep the change id; explain why the old gate no longer covers the use.
- The red check runs against the **existing target’s current state**, not the prerequisite alone.
  If the evaluation branch does not include the target, the orchestrator opens a check workspace
  at the target and restores the new test paths from the gate draft into it; run the red command
  there. Do not edit the target.
- If the old gate already passes on the current target and the refine is meant to change behavior,
  the gate is not red. Either the change is already satisfied (cite it) or the gate must be amended
  before implementation.
- Land the amended evaluation into its own node, then freeze a **new** hash. The old hash and any
  verdict based on it are void.

Adding a new evaluation for a refine follows the same red rule: open the gate draft at the evaluation
skeleton the skeleton pass created, author the check for the new use, and run red against the
target’s current state in the check workspace.

The orchestrator records and hashes the gate; you do not.

## 7. Freeze

The orchestrator records the gate and computes a hash over the evaluation document and every test
path. You do not record it. Report:

```text
evaluation: <change id>
edge: <decision> -> <prerequisite>
form: <...>
changed paths: <...>
red command: <...>
red output: <...>
why this is the use: <...>
assumptions / risks: <...>
```

After the hash is frozen, any edit to the evaluation or its tests is a **new gate**. Do not make
one silently; the orchestrator must return the unit to you and re-freeze.

## 8. Gate defects

Return a gate defect instead of a weak gate when:

- the test cannot distinguish the prerequisite from the implementation;
- the only available check asserts an implementation detail the decision does not require;
- the criterion depends on a decision that is not recorded;
- the edge’s use cannot be named;
- the test would need the implementation to even compile.

A gate defect stops the unit. The drafter does not fix it; the planner may need to split or
settle a decision first.

A judge’s `gate-weak` finding is different: the gate was authored and frozen, and the judge reports
that it is not strong enough to prove the decision. That is an advisory to the user, not a
gate-defect verdict; the user decides whether to accept it or return the unit for an amended gate.
