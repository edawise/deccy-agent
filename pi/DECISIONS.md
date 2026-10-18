# deccy-agent — decisions

Rules live in code (`workflows/lib/hostValidators.ts`) and the `README.md`;
this records only the reasoning that isn't obvious from the code.

## Workflow shape

- **deccy-edit**: direct edits / node adds, no
  plan artifact. Every turn must end in one enforced fenced-JSON edit-report
  (`summary`/`created`/`edited`/`deviations`), with one corrective retry.
- **Structural changes** are out of scope: rewiring `depends_on`/`evaluates`,
  changing `kind` / `content.ref` / `content.type`, deleting or retitling a
  node, or broad work (many new nodes) — deccy-edit does the part that fits and
  reports the rest as a deviation; the engineer decides. Multi-node edits are
  in scope (one node at a time, each `deccy record`d separately) — the line is
  structural change, not node count.

## Invariants and caps

- **Custody**: a node's `nodes/<id>.json` plus its `ref`'d paths carry its
  content and nobody else's. Every edit must be `deccy record`ed into its owning
  change — including node-document edits (that's where `ref: "inline"` content
  lives). Checkers run host-side after every turn.
- **Validators over trust**: `deccy validate` exits 0 even when dirty — judge by
  its output, not the exit code. Validators run host-side after every turn;
  `deccy undo`/`jj op restore` back out bad turns.
- **Caps**: ≤ 2 automatic rework rounds (trivial classes only) — rework must
  converge, not iterate forever.
- **Enforcement is tools, not prose**: read-only REPL turns (`/ask`, `/plan`)
  narrow the session to `read` via `setActiveToolsByName`.

## Terminal output

- **ANSI styling is stream-gated**: `workflows/lib/ttyStyle.ts` wraps raw SGR
  codes only when the destination is a TTY (`NO_COLOR`/`TERM=dumb` disable,
  `FORCE_COLOR` overrides) — pipes (tests, JSON consumers) get plain text, and
  there is no terminal-color dependency.
- **REPL replies get a cyan `│` gutter** (applied once in the REPL loop) so
  model output reads as a block against echoed input; reply sections are colored
  by meaning — `Edit:` counts green/cyan, deviations yellow, validation
  ✓green/✗red, `deccy log` ids cyan with kinds magenta/yellow — with the
  semantic formatting living in each workflow. **Reply prose is terminal
  Markdown** (`workflows/lib/mdTerm.ts`): headings bold cyan, code yellow,
  list bullets/numbers cyan, quotes dim, links cyan — identity on non-TTY
  streams so pipes keep the raw Markdown.

## Skill trees

- `skills/deccy-agent` (opencode `install.sh`) and `pi/skills/deccy-agent`
  (`install-pi.sh`; what deccy-edit prepends) have **diverged** — SKILL.md
  wording, reference filenames (`evaluation-conventions.md` vs
  `evaluations.md`/`eval-cells.md`), even `check-topology.py` error text.
  `pi/` is authoritative for deccy-edit.
- The checker-script wording (skill-bundle-relative `scripts/…`, missing in the
  target repo is never a deviation) was tightened in `pi/` only
  (SKILL.md §3, `references/deccy-workflow.md`, `references/decision-placement.md`,
  the role bullet, and prompt assembly: toolkit section first in edit prompts,
  read-only guidance in `/ask`+`/plan`). The opencode tree and
  `agents/deccy-agent.md` still carry the old skill-relative phrasing — syncing
  them is a separate task.

## deccy CLI quirks (verified against deccy 0.1.0)

- `deccy new` inserts the new change after the newest `--on` id and rebases
  descendants above it.
- **Forked-insert bug**: a `deccy new` whose insert must rebase existing
  descendants (e.g. a second `--on zzzzzzzz` sibling) fails with
  "No such file or directory" *and deletes `nodes/` from the working copy*.
  Prefer chained `--on <existing node>`; if hit, recover with `jj op restore`.
