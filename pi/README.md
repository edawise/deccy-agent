# deccy-agent pi workflows

Standalone SDK workflow scripts for working on a **deccy (decision) graph**.

The reference brain is `skills/deccy-agent/` (SKILL.md + references/): skill and
reference bodies are prepended/linked by absolute path into stage prompts and
are the single source of truth. Design notes and decisions: `DECISIONS.md`.

## Setup

```sh
cd pi
npm install          # pulls @earendil-works/pi-coding-agent
node --test "workflows/**/*.test.ts"   # zero model calls
```

Requires Node ≥ 22 (native TypeScript), and, for real runs: `deccy` and `jj` on
PATH in the graph repo, `python3` for the two read-only checker scripts.

## Using the scripts elsewhere

The scripts are location-independent — the target graph is always `--graph
<dir>` (default: cwd), so **nothing needs to be copied into a project**. Three
ways to use them elsewhere:

1. **One-line install** — same UX as `install.sh`:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/edawise/deccy-agent/main/install-pi.sh | sh
   ```

   Installs `pi/` to `~/.pi/agent/deccy-agent` (one `npm install`), symlinks
   `deccy-agent` into `~/.pi/agent/skills/` (pi follows symlinked skill dirs,
   so the skill stays a single source of truth), and drops the `deccy-edit`
   command into `~/.local/bin`. Options: `--project <dir>` (skill links into
   `<dir>/.pi/skills/`), `--ref`, `--uninstall`, and `REPO_URL` / `DEST_APP` /
   `DEST_SKILLS` / `DEST_BIN` env overrides — same conventions as `install.sh`.

   ```sh
   deccy-edit "<request>" --graph /path/to/deccy-repo
   ```

2. **Run in place** from a checkout — any cwd:

   ```sh
   node ~/path/to/deccy-agent/pi/workflows/deccy-edit/index.ts "<request>" --graph .
   ```

3. **Skill-only** for pi chat sessions: symlink `pi/skills/deccy-agent` into
   `.pi/skills/` of a trusted project (or `~/.pi/agent/skills/`) so the domain
   brain is available to interactive sessions.

Everything is local: no command pushes, and the CLI only ever touches the
`--graph` repo (plus the report file it names).


## deccy-edit

```
node workflows/deccy-edit/index.ts ["<request>"] [--graph <dir>]
     [--interactive|-i] [--model provider/model[:thinking]]
```

| Flag | Meaning |
|---|---|
| `"<request>"` | positional: the edit/add directive (required for one-shot runs; with `-i` it runs as the first turn) |
| `--graph <dir>` | graph repo root (default: cwd) |
| `--interactive`, `-i` | REPL on the live session: `/ask <q>` read-only answers, `/plan <task>` proposes edits without applying (say `apply` to execute), `/check` validators, `/status` `deccy log`, `/undo` `deccy undo`; everything else is an edit turn. Compose: **Ctrl-G** opens `$VISUAL`/`$EDITOR` for the prompt (save+exit stages it — Enter runs it; quit without saving cancels); a **paste is echoed and staged — Enter runs it**, newlines intact; **Tab** completes file/folder paths in the graph dir (Tab again lists matches — directories keep a trailing `/` so the next Tab descends) | (both use `$VISUAL`/`$EDITOR`; e.g. `export EDITOR="code --wait"` for VS Code — `--wait` is required)
| `--no-thinking` | silence the thinking stream (one-shot runs print the model's thinking to stderr by default; the REPL shows the vanishing spinner instead) |
| `--model provider/model[:thinking]` | model override (pi syntax) |

One agent call (role `deccy-edit`): edit the
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

### Composing prompts in an editor (Ctrl-G, interactive mode)

Press **Ctrl-G** in the REPL to edit the staged prompt (pasted/typed text) in
`$VISUAL` / `$EDITOR` (fallback: `vi`). Save+exit **stages** the buffer —
Enter runs it; quitting without saving cancels.

**VS Code** — set the editor before launching, `--wait` is required (the REPL
reads the file when the tab closes):

```sh
export EDITOR="code --wait"      # or VISUAL="code --wait"
deccy-edit -i --graph <graph-repo>
```

**vim**, the minimum you need:

| Key | Effect |
|---|---|
| `i` | start typing (insert mode) |
| `Esc` | stop typing, back to commands |
| `:wq` `Enter` | save + exit → buffer is staged; Enter in the REPL runs it |
| `:q!` `Enter` | quit discarding → cancels (nothing staged) |

(`:q` after typing fails with `E37` — vim won't drop unsaved text; use `:wq`
or `:q!`.)


## Layout

```
skills/
  deccy-agent/            # reference brain (SKILL.md + references/ + checkers)
workflows/
  lib/                    # shared host-side logic (pure, tested)
    stageJson.ts          # fenced-JSON seam (adapted from edagent, MIT)
    interactiveRework.ts  # REPL loop (copied from edagent, MIT)
    pasteFilter.ts        # bracketed paste → one staged input (0 LLM)
    graphReader.ts        # nodes/*.json → typed graph (0 LLM)
    graphDigest.ts        # graph digest for prompts (derived, 0 LLM)
    hostValidators.ts     # 0 LLM checks (deccy validate + skill checkers)
    deccyCli.ts           # DeccyRunner + deccy/jj/checker process runner
    fixtures/             # fixture graph for tests
  deccy-edit/             # roles/deccy-edit.system.md, stages/edit.ts
```

The role `.system.md` file is the engineer's editing surface — tune edit
conventions there; the controller owns all writes.

## Tests

`node --test "workflows/**/*.test.ts"` — 27 tests, zero model calls: graph
reading (prefix resolution, history order, custody, document diagnostics),
host validators, toolkit path resolution, thinking-stream plumbing, and the
full deccy-edit pipeline with stubbed sessions (edit-report enforcement,
bounded rework, precondition refusals, REPL turns). `--help` smoke tests exit
0; unknown flags exit 2.
