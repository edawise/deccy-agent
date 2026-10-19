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

## REPL input

- **Logical-input queue** (`workflows/lib/interactiveRework.ts`): readline lines,
  bracketed pastes, and Ctrl-G editor results all dispatch through one queue —
  one input = one turn, arrival-ordered even while a turn is running.
- **Paste is staged, never auto-submits** (`workflows/lib/pasteFilter.ts`): a
  `\x1b[200~`…`\x1b[201~` region is swallowed from the readline stream and
  re-emitted as one `paste` event, newlines intact (readline alone would
  submit at every `\n`). The paste is echoed so the user sees what they
  pasted, staged as pending input, and only **Enter** runs it; typing
  afterwards appends a line. A single-line paste lands in the prompt line (its
  trailing newline is dropped — paste never runs by itself). The filter
  enables DECSET 2004 at start; terminals without bracketed paste keep the
  per-line behavior.
- **Tab completes paths word-level** (`workflows/lib/pathComplete.ts`): the
  readline completer gets the line up to the cursor and returns
  `[matches, completeOn]`, every match a full replacement of the trailing
  word — cursor-correct even mid-line, with insertion and match listing done
  by readline itself (a **second** Tab lists ambiguous matches; that is
  Node's `previousKey was tab` rule). Paths resolve against the graph dir
  (`./`, `../`, `~/` allowed; the typed prefix is kept verbatim in the
  replacement), dirs complete with a trailing `/` so the next Tab descends,
  `node_modules`/`.git`/`.jj` are never suggested, and dot-entries only when
  the word starts with one. Slash words complete nothing — command naming
  belongs to the command surface, not to path completion.
- **Ctrl-G opens `$VISUAL`/`$EDITOR`** for the prompt (temp file, inherited
  stdio; `EDITOR="code --wait"` for VS Code — `--wait` is required so the
  launcher blocks until the file closes). The buffer is pre-seeded with the
  staged paste + typed line so it can be edited as one; a hint announces the
  save/quit keys (vim: Esc then `:wq` run / `:q!` cancel). Save+exit **stages**
  the buffer (echoed, `[editor buffer staged — Enter runs it]`) — nothing runs
  without Enter — and quitting without saving cancels (`[editor cancelled]`).
  The opener is an injectable seam (`openEditor`) for tests.

## deccy CLI quirks (verified against deccy 0.1.0)

- `deccy new` inserts the new change after the newest `--on` id and rebases
  descendants above it.
- **Forked-insert bug**: a `deccy new` whose insert must rebase existing
  descendants (e.g. a second `--on zzzzzzzz` sibling) fails with
  "No such file or directory" *and deletes `nodes/` from the working copy*.
  Prefer chained `--on <existing node>`; if hit, recover with `jj op restore`.
