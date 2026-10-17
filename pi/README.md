# deccy-agent pi workflows

Standalone SDK workflow scripts for working on a **deccy (decision) graph**:
`deccy-planner` plans a request into nodes/edges/evaluations and writes
`.deccy_plan.md` for human review; `deccy-executor` applies the approved plan;
`deccy-edit` applies direct edits / node adds with **no plan at all**.
Plain Node CLI scripts driving `createAgentSession` from
`@earendil-works/pi-coding-agent` — no registration anywhere.

The reference brain is `skills/deccy-agent/` (SKILL.md + references/): skill and
reference bodies are prepended/linked by absolute path into stage prompts and
are the single source of truth. Design notes and decisions: `DECISIONS.md`.

## Interactive planning skill (`skills/deccy-plan/`)

A pi skill for planning **inside an interactive pi session** — interview the
request, draft plan blocks in chat, gate them, write `.deccy_plan.md` — without
running the planner CLI. It is separate from the workflows but checks the same
rules: `skills/deccy-plan/scripts/plan-gate.ts` is a thin entrypoint around
`workflows/lib/planValidate` (rules are never re-implemented).

```sh
node skills/deccy-plan/scripts/plan-gate.ts --plan <graph>/.deccy_plan.md --graph <graph>
# exit 0 pass (warnings allowed) | 1 fail | 2 usage
```

To make pi discover it, either work in a trusted project with a symlink:

```sh
mkdir -p .pi/skills && ln -s <repo>/pi/skills/deccy-plan .pi/skills/deccy-plan
ln -s <repo>/pi/skills/deccy-agent .pi/skills/deccy-agent   # the domain brain
```

(`install-pi.sh` does exactly this for you, globally or with `--project`.)

or add the directory to `~/.pi/settings.json` / project `.pi/settings.json`:
`"skills": ["<repo>/pi/skills"]`. A plan written by the skill is
executor-compatible and vice versa — the file format is the contract.

## Setup

```sh
cd pi
npm install          # pulls @earendil-works/pi-coding-agent
node --test "workflows/**/*.test.ts"   # zero model calls
```

Requires Node ≥ 22 (native TypeScript), and, for real runs: `deccy` and `jj` on
PATH in the graph repo, `python3` for the two read-only checker scripts.

## 

The scripts are location-independent — the target graph is always `--graph
<dir>` (default: cwd), so **nothing needs to be copied into a project**. Three
ways to use them elsewhere:

1. **One-line install**
   `install.sh` UX:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/edawise/deccy-agent/main/install-pi.sh | sh
   ```

   Installs `pi/` to `~/.pi/agent/deccy-agent` (one `npm install`), symlinks
   `deccy-agent` + `deccy-plan` into `~/.pi/agent/skills/` (pi follows symlinked
   skill dirs, so the skills stay a single source of truth and
   `plan-gate.ts`'s relative imports keep working), and drops `deccy-plan` /
   `deccy-exec` commands into `~/.local/bin`. Options: `--project <dir>` (skill
   links into `<dir>/.pi/skills/`), `--ref`, `--uninstall`, and `REPO_URL` /
   `DEST_APP` / `DEST_SKILLS` / `DEST_BIN` env overrides — same conventions as
   `install.sh`.

   ```sh
   deccy-plan "<request>" --graph /path/to/deccy-repo
   deccy-exec --plan .deccy_plan.md --graph /path/to/deccy-repo
   deccy-edit "<request>" --graph /path/to/deccy-repo
   ```

2. **Run in place** from a checkout — any cwd:

   ```sh
   node ~/path/to/deccy-agent/pi/workflows/deccy-planner/index.ts "<request>" --graph .
   ```

3. **Skill-only** for pi chat sessions: symlink `pi/skills/*` into
   `.pi/skills/` of a trusted project (or `~/.pi/agent/skills/`) as shown below.

Everything is local: no command pushes, and the CLIs only ever touch the
`--graph` repo (plus the plan/report files they name).

## deccy-planner

```
node workflows/deccy-planner/index.ts "<request>" [--graph <dir>]
     [--out .deccy_plan.md] [--prompt "..."] [--revise] [--interactive|-i]
     [--model provider/model[:thinking]]
```

| Flag | Meaning |
|---|---|
| `"<request>"` | positional: the work to plan (required for fresh runs) |
| `--graph <dir>` | graph repo root (default: cwd) |
| `--out <path>` | plan artifact (default: `<graph>/.deccy_plan.md`) |
| `--prompt "..."` | engineer directives (creation objectives or revision feedback) |
| `--revise` | revision round: the on-disk plan (incl. hand-edits) is authoritative input |
| `--interactive`, `-i` | REPL: feedback lines are rework directives; `/check` re-runs the gate host-side (0 LLM), `/status` prints the graph digest, `/plan` prints the plan |
| `--model provider/model[:thinking]` | model override (pi syntax) |

Read-only: the planner never mutates the graph. It compiles the graph
(`nodes/*.json` + `deccy log` + `jj` history), asks the `deccy-plan` role for
plan blocks, renders `.deccy_plan.md` deterministically (no LLM in the write
path), and runs the **plan gate**.

## deccy-executor

```
node workflows/deccy-executor/index.ts [--plan .deccy_plan.md] [--graph <dir>]
     [--prompt "..."] [--revise] [--interactive|-i]
     [--model provider/model[:thinking]]
```

| Flag | Meaning |
|---|---|
| `--plan <path>` | approved plan (default: `<graph>/.deccy_plan.md`) |
| `--graph <dir>` | graph repo root (default: cwd) |
| `--prompt "..."` | engineer directives for the content stage / rework |
| `--revise` | re-run content + validation with directives (placement is idempotent) |
| `--interactive`, `-i` | REPL: `/check` validators, `/status` `deccy log`, `/undo` `deccy undo`, `/plan` plan + localId map; everything else is a content-rework turn |

Phases: (1) parse + gate the plan against the *current* graph — a plan that no
longer validates is refused with reasons; (2) **placement** (0 LLM): `deccy
new` (one `--on` per id, deps first), node-document fills, `deccy record`,
`jj describe` for summary changes, canonical `jj rebase -r` restacks, and the
`localId → change id` mapping written back into the plan (rerun-safe); (3)
**content** (role `deccy-exec`): implement each node's `files`, `deccy record`
into the node; (4) **validation rounds** (host): `deccy validate`,
`scripts/check-topology.py`, `scripts/check-ref-custody.py`, fed back as ≤ 2
rework rounds; (5) `deccy-exec.report.md` + exit code.

## deccy-edit

```
node workflows/deccy-edit/index.ts ["<request>"] [--graph <dir>]
     [--interactive|-i] [--model provider/model[:thinking]]
```

| Flag | Meaning |
|---|---|
| `"<request>"` | positional: the edit/add directive (required for one-shot runs; with `-i` it runs as the first turn) |
| `--graph <dir>` | graph repo root (default: cwd) |
| `--interactive`, `-i` | REPL on the live session: `/ask <q>` read-only answers, `/plan <task>` proposes edits without applying (say `apply` to execute), `/check` validators, `/status` `deccy log`, `/undo` `deccy undo`; everything else is an edit turn |
| `--no-thinking` | silence the thinking stream (one-shot runs print the model's thinking to stderr by default; the REPL shows the vanishing spinner instead) |
| `--model provider/model[:thinking]` | model override (pi syntax) |

For simple edits and direct node adds there is no `.deccy_plan.md` and no
placement phase — the same enforced-output seam as the executor, pointed
straight at the working copy. One agent call (role `deccy-edit`): edit the
target nodes' `ref`'d files and `deccy record` them into their node, and/or
`deccy new -m <summary> --on <id>...` a small addition and record its files
into it. The run must conclude with a fenced ` ```json ` **edit-report**
(`summary` / `created` / `edited` / `deviations`); `summary` is the human
recap of what changed, printed after every turn (and in the payload), and an
unusable report earns one corrective follow-up. Then the host validators run
(`deccy validate` + the two checker scripts) with ≤ 2 bounded rework rounds,
and the payload JSON goes to stdout.
Read-only turns in the REPL (`/ask`, `/plan`) narrow the session's tools to
`read` for that turn — nothing can be mutated until the next directive.
There is deliberately no `--prompt` / `--revise`: the request line (or the
REPL) is the only input surface. Exit codes: `0` clean, `1` failed (named
reason in the payload), `2` usage.

## The plan gate (machine-checked, not prose)

`.deccy_plan.md` = prose sections + fenced ` ```json ` blocks (`kind`:
`node`/`restack`/`flags`). The gate (`workflows/lib/planValidate.ts`) checks:

| Rule | Checks |
|---|---|
| R1 | block shape per kind/action; decisions never carry `evaluates`; `content.ref` XOR inline content; `ref` ⊆ `files` |
| R2 | every existing-id reference resolves unambiguously (`nodes/<id>.json`, prefix matching) |
| R3 | every planned decision ends with ≥ 1 `depends_on` (I2) |
| R4 | every planned evaluation ends with ≥ 1 `evaluates` (I3) |
| R5 | every decision→decision edge the plan introduces/touches is I4-covered (planned or existing evaluation) |
| R6 | custody: a new node's `files` are unowned; an edit's `files` are its own ref paths or unowned |
| R7 | creation order exists (deps first); a forked `--on` set demands a restack block or fails |
| R8 | a rewiring edge that inverts history order demands a matching `restack` block |
| R9 | near-duplicate summaries and unknown `evalCell` warn (human checkpoint decides) |

Trivial violations (R2 dangling ids, R5 uncovered edges, `evalCell` typos) earn
≤ 2 automatic rework rounds with deterministic directives; everything else
routes to the human. Hard caps: ≤ 12 new nodes per plan, ≤ 2 auto-rework
rounds.

## Review protocol (the human checkpoint)

1. Run the planner; read `<graph>/.deccy_plan.md` — one section per node with
   its JSON block. `deccy-plan.report.md` (only when the gate rejects) names
   every violation and its rule.
2. Edit freely: JSON blocks are the contract (localIds, edges, `files`,
   restacks); prose around them is yours except section headings, which the
   parser uses. A broken block is a hard failure naming the section — fix the
   JSON, never delete the block.
3. Revise through the planner (`--revise [--prompt "..."]` or `-i`); hand-edits
   are preserved as authoritative input.
4. Apply with the executor. Skim `deccy-exec.report.md`: created/edited nodes
   with real ids, validation results, and **deviations** (the content role
   reports what it could not place; it never silently diverges).
5. If validation still fails, `-i` and iterate (`/check`, `/undo`, directives).

Exit codes for both scripts: `0` success, `1` validation/stage failure (named
reason in the stdout payload and/or `*.report.md`), `2` usage.

## Layout

```
skills/
  deccy-agent/            # reference brain (SKILL.md + references/ + checkers)
  deccy-plan/             # interactive planning skill + scripts/plan-gate.ts
workflows/
  lib/                    # shared host-side logic (pure, tested)
    stageJson.ts          # fenced-JSON seam (adapted from edagent, MIT)
    interactiveRework.ts  # REPL loop (copied from edagent, MIT)
    graphReader.ts        # nodes/*.json → typed graph (0 LLM)
    planSchema.ts         # plan-block types + R1 shape
    planParse.ts          # .deccy_plan.md → blocks (hard-fail naming sections)
    planValidate.ts       # THE gate: R1–R9 + rework-directive synthesis
    planRender.ts         # blocks → .deccy_plan.md (controller-owned)
    hostValidators.ts     # 0 LLM checks (deccy validate + skill checkers)
    deccyCli.ts           # DeccyRunner + deccy/jj/checker process runner
    fixtures/             # SKILL.md §5 worked example graph + sample plans
  deccy-planner/          # roles/deccy-plan.system.md, stages/planAuthor.ts
  deccy-executor/         # roles/deccy-exec.system.md, stages/{placement,content}.ts
  deccy-edit/             # roles/deccy-edit.system.md, stages/edit.ts
```

The role `.system.md` files are the engineer's editing surface — tune planning
judgment and content conventions there; the controllers own all writes.

## Tests

`node --test "workflows/**/*.test.ts"` — 74 tests, zero model calls: pure gate
rules (one per rule), parse/render round-trips, placement argv sequences
against a fake runner, and full planner/executor/editor pipelines with
stubbed sessions (including the edit-report corrective-retry seam). `--help`
smoke tests exit 0; unknown flags exit 2.
