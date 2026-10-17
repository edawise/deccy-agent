# deccy-agent — decisions

Rules live in code (`workflows/lib/planValidate.ts`,
`workflows/lib/hostValidators.ts`) and the `README.md` tables; this records only
the reasoning that isn't obvious from the code.

## Workflow shape

- **deccy-edit**: direct edits / node adds, no plan artifact.
  Every turn must end in one enforced fenced-JSON edit-report
  (`summary`/`created`/`edited`/`deviations`), with one corrective retry — the
  same output seam as the executor.
- **deccy-planner + deccy-executor** for structural work
  (rewiring, eval sandwiches, multi-node changes): plan → human gate →
  deterministic placement → LLM content. If a real structural change never uses
  them, delete both (keep `lib/planValidate.ts` + `plan-gate.ts`).

## Invariants and caps

- **Custody**: a node's `nodes/<id>.json` plus its `ref`'d paths carry its
  content and nobody else's. Every edit must be `deccy record`ed into its owning
  change — including node-document edits (that's where `ref: "inline"` content
  lives). Checkers run host-side after every turn.
- **Validators over trust**: `deccy validate` exits 0 even when dirty — judge by
  its output, not the exit code. Post-hoc validators cover what the pre-mutation
  gate catches; `deccy undo`/`jj op restore` back out bad turns.
- **Caps**: ≤ 12 new nodes per plan; ≤ 2 automatic rework rounds (trivial
  classes only) — rework must converge, not iterate forever.
- **Enforcement is tools, not prose**: read-only REPL turns (`/ask`, `/plan`)
  narrow the session to `read` via `setActiveToolsByName`; a prompt asking the
  model to "please not edit" is not enforcement.

## deccy CLI quirks (verified against deccy 0.1.0)

- `deccy new` inserts the new change after the newest `--on` id and rebases
  descendants above it.
- **Forked-insert bug**: a `deccy new` whose insert must rebase existing
  descendants (e.g. a second `--on zzzzzzzz` sibling) fails with
  "No such file or directory" *and deletes `nodes/` from the working copy*.
  Prefer chained `--on <existing node>`; if hit, recover with `jj op restore`.
