# Plan: coherent checker-script guidance across deccy-edit prompts

Status: plan only — no code changes yet.
Scope rule: **implementation edits are confined to the `pi/` tree.** Anything outside it
(`skills/` opencode copy, `agents/`, `install*.sh`) is left untouched even where it repeats the
same flawed wording.
Target change: `oqwlluxm` ("plan: coherent checker-script guidance across deccy-edit prompts").

## Context (why)

A `deccy-edit -i` turn surfaced the deviation:

> **Deviation 2:** the check scripts `scripts/check-topology.py` / `scripts/check-ref-custody.py`
> don't exist at `scripts/` here. `deccy validate` still covers validity/resolution/I4.

The claim is false: the scripts ship in the deccy-agent bundle
(`pi/skills/deccy-agent/scripts/`, mirrored at `~/.pi/agent/deccy-agent/skills/deccy-agent/scripts/`),
`checkerScriptPath()` resolves them cwd-independently, and `runHostValidators` runs both
absolute-path invocations after every turn anyway. The model looked at `scripts/` **in the target
graph repo** (which correctly has none) and reported that expected condition as a deviation.

Root cause: three mutually inconsistent instructions in one prompt, plus placement/coverage gaps.

1. `skills/deccy-agent/SKILL.md` §3 checklist (~L69-77) says to run `scripts/check-topology.py`
   / `scripts/check-ref-custody.py` — skill-relative paths, no `<repo-root>` arg. Only resolvable
   when cwd is the skill dir; in a target graph repo they point nowhere. SKILL.md §1 also trains
   "note the deviation explicitly" when expected layout is missing — exactly the observed behavior.
2. `pi/workflows/deccy-edit/roles/deccy-edit.system.md` says the checkers "run host-side after
   your turn … don't go looking for checker scripts" — contradicting both (1) and (3).
3. `toolkitSection()` (`pi/workflows/lib/hostValidators.ts:32-43`) gives the correct absolute paths
   and "the target repo has no scripts/ directory" — but it is appended near the **end** of
   `buildEditPrompt`, right before the (verbose) graph digest, and `buildReadOnlyPrompt`
   (`pi/workflows/deccy-edit/stages/edit.ts:139-175`) never includes it at all, so `/ask` and
   `/plan` see only the broken relative-path checklist.

## Policy (single source of truth going forward)

The two checker scripts live in the deccy-agent skill **bundle**, not the target repo. The host
runs `deccy validate` + both checkers after every turn regardless. Agent self-check is **optional**
and must use the absolute paths from the "Validation toolkit" section. A missing skill-relative
`scripts/…` path in the target repo is expected and is **never** a deviation.

## Tasks

### 1. SKILL.md checklist block — location-agnostic phrasing

Files: `pi/skills/deccy-agent/SKILL.md` (~L69-82) — the copy deccy-edit actually prepends.
The opencode copy `skills/deccy-agent/SKILL.md` has the same flaw but is outside `pi/`: untouched.

- Rewrite the fenced block: invoke as `python3 <skill-bundle>/scripts/check-topology.py <graph-root>`
  (the scripts accept `[repo-root]`; the current block omits it) with a one-line note that the
  scripts ship inside this skill's own directory and that their absolute paths are handed to
  deccy-edit turns in the Validation toolkit section.
- Keep the closing paragraph ("`deccy validate` covers validity, resolution and I4 … does **not**
  check topology or custody") but append: if you cannot resolve the two scripts' absolute paths,
  skip them — the host runs them after your turn; do not report them missing.

### 2. Mirrored mentions elsewhere in `pi/` (same phrasing)

- `pi/skills/deccy-agent/references/deccy-workflow.md:115-121`
- `pi/skills/deccy-agent/references/decision-placement.md:77,94`

Same flaw, outside `pi/`, untouched: `agents/deccy-agent.md:50` and the `skills/`-tree mirrors.

Rule for all: never present the scripts as `scripts/…` relative to the target repo; say
"the deccy-agent skill bundle's `scripts/…`, against the graph root".

### 3. Remove the role contradiction

File: `pi/workflows/deccy-edit/roles/deccy-edit.system.md` (Rules bullet "don't go looking for
checker scripts").

- Replace with the policy sentence: host re-runs `deccy validate` + both checkers after every
  turn; optional self-check uses the absolute paths from the Validation toolkit section; a missing
  skill-relative `scripts/` path is expected and never a deviation.

### 4. Prompt assembly — placement and read-only coverage

File: `pi/workflows/deccy-edit/stages/edit.ts`.

- `buildEditPrompt`: move `toolkitSection(args.graphRoot)` up — directly after the
  Request/Validation-Errors/Notes block, **before** `buildGraphDigest` is unchanged but the toolkit
  must no longer be buried against the digest (keep exactly one copy).
- `buildReadOnlyPrompt`: include the toolkit guidance in both modes so `/ask` and `/plan` cannot
  regress into the same trap (`/plan` explicitly says "note foreseeable deviations", which is what
  produces numbered items like "Deviation 2"). Full `toolkitSection(graphRoot)` for `/plan`;
  a one-line "checkers are host-run; don't look for `scripts/` here" note suffices for `/ask`
  (decide at implementation time; uniform full section is also fine).

### 5. Tests

File: `pi/workflows/deccy-edit/index.test.ts` (extend), `pi/workflows/lib/hostValidators.test.ts`
(unchanged behavior).

- Assert the edit prompt carries the toolkit section **before** the graph digest (order matters —
  this is the regression that caused the deviation).
- Assert `buildReadOnlyPrompt` output contains the guidance for both modes.
- Keep existing assertions (`/check-topology\.py \/tmp\/tb1/`) green.
- Run `node --test` in `pi/`.

### 6. Record the tree drift (`pi/`-only — no sync edits)

`skills/deccy-agent` (opencode `install.sh`) and `pi/skills/deccy-agent` (`install-pi.sh`, used by
deccy-edit) have **already diverged** (SKILL.md wording, reference filenames
`evaluation-conventions.md` vs `evaluations.md`/`eval-cells.md`, even `check-topology.py` error
text). Since scope is confined to `pi/`, this plan does **not** sync them — it only notes the drift
(and this plan's wording fixes) in `pi/DECISIONS.md` so a later reconciliation — a separate task,
likely paired with the out-of-`pi/` mirrors from task 2 — can pick them up.

## Out of scope

- **Everything outside `pi/`**: the `skills/` opencode tree, `agents/`, `install.sh`/`install-pi.sh`
  — untouched even where they repeat the flawed wording (tracked via task 6 note).
- Checker script logic (`check-*.py`), `runHostValidators` behavior, REPL rendering/ttyStyle work
  (belongs to `qrtlkwyv`), and wholesale reconciliation of the diverged skill trees.

## Acceptance

- Built edit prompt has exactly one toolkit section, positioned before the graph digest;
  read-only prompts carry the guidance.
- No prompt text presents `scripts/…` as resolvable in the target repo.
- Only files under `pi/` are modified.
- `node --test` in `pi/` green.
- Manual smoke (optional): a `deccy-edit -i` `/plan` turn on a repo without `scripts/` no longer
  emits a "check scripts don't exist" deviation.
