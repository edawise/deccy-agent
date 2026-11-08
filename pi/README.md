# deccy agent — Pi

Pi-specific paths, invocation, role routing and guard enforcement for the deccy agent bundle. See the root [`README.md`](../README.md) for the shared round protocol, roles, installer
options and limitations.

The link installs the five shared skills, the five role agent files, the `deccy-role.ts` extension
and the `deccy-pi` launcher. `deccy-pi` starts the two root roles (`plan`, `orchestrator`); the
orchestrator spawns the four worker roles (`plan`, `gate-author`, `drafter`, `judge`) as Pi
subagents.

## Requirements

- **Pi 1.0.0 or newer.** The bundle is tested at `1.5.0`; `pi/link.sh` refuses an older release.
  See [Upgrading Pi](#upgrading-pi) before moving to a newer one.
- `python3` for the `subagents.json` merge and the shared deccy check scripts.
- Node `23.6+` (or `22.6+` with `--experimental-strip-types`) to run the TypeScript extension tests
  directly; Pi itself bundles its own runtime.
- `jj` for draft workspaces and graph changes, and `deccy` for graph writes. Both are checked when
  a role starts and produce a warning if missing.
- `git` for the installer's clone; an existing `--from` checkout does not need it.

## Locked plugin combination

| Need | Package | Pinned | Role |
|---|---|---|---|
| Subagents and custom agents | `@gotgenes/pi-subagents` | `25.0.5` | Child sessions, custom `agents/*.md`, per-agent `tools:`, parallel/background runs, steer/resume, `ask_parent`/`notify_parent` |
| Permission enforcement | `@gotgenes/pi-permission-system` | `42.0.0` | Per-agent `permission:` frontmatter, `allow`/`ask`/`deny`, ordered bash patterns, skill and tool hiding |
| Structured user choices (optional) | `@juicesharp/rpiv-ask-user-question` | `2.15.0` | A model-callable `ask_user_question` tool for the planner and orchestrator |

The versions are pinned in `pi/link.sh` (`PKG_SUBAGENTS`, `PKG_PERMISSIONS`, `PKG_ASK`). The
launcher and the role files are written against exactly these surfaces; see
[Upgrading Pi](#upgrading-pi).

### Do not combine subagent packages

Do **not** install any of these alongside `@gotgenes/pi-subagents`:

- `nicobailon/pi-subagents` — registers a competing `subagent` tool;
- `@tintinweb/pi-subagents` — registers a competing `subagent` tool;
- `@gotgenes/pi-subagents-worktrees` — adds git-worktree isolation, which conflicts with deccy's
  jj workspaces.

`pi/link.sh` inspects `pi list` and refuses to link when another `subagent`-registering package is
already configured. To switch stacks, remove the conflicting package first:

```sh
pi remove <source>
./pi/link.sh
```

Use `--no-packages` when you want the links without the package checks, for example in a shared or
air-gapped environment.

## Paths and verification

`pi/link.sh` (and `pi/install.sh`) symlinks the five shared skills, the five role agent files, the
`deccy-role.ts` extension and the `deccy-pi` launcher:

- **Global (default):** `~/.pi/agent/skills/deccy-*`, `~/.pi/agent/agents/deccy-*.md`,
  `~/.pi/agent/extensions/deccy-role.ts`, and `~/.local/bin/deccy-pi`.
  It also writes `~/.pi/agent/subagents.json` (setting `maxConcurrent` to `6` when it is missing or
  null) and, in the neutral deccy cwd, `~/.local/share/deccy/agent/.pi/agents/general-purpose.md`
  with `enabled: false`.
- **Project (`--project <dir>`):** `<dir>/.pi/skills`, `<dir>/.pi/agents`, `<dir>/.pi/extensions`,
  `<dir>/.pi/bin/deccy-pi`, and `<dir>/.pi/subagents.json`.

`PI_AGENT_DIR` (or `PI_CODING_AGENT_DIR`) relocates the global Pi agent directory;
`DEST_SKILLS`, `DEST_AGENTS`, `DEST_EXTENSIONS` and `DEST_BIN` override the individual global
destinations. `DECCY_AGENT_ROOT` moves the deccy state root, but the role permission path
patterns are anchored to `~/.local/share/deccy/agent/`; see
[Changing the state root](#changing-the-state-root).

Verify the install:

```sh
ls -la ~/.pi/agent/skills/deccy-*
ls -la ~/.pi/agent/agents/deccy-*.md
./pi/link.sh --list                     # links, packages and safety files
pi list                                 # package sources and versions
node pi/tests/deccy-role.test.mjs       # 27 deterministic extension checks
```

`link.sh` never copies and refuses to replace files or links it did not create, so `git pull`
updates stay live without re-linking. `link.sh` supports `--list`, `--uninstall` and `--purge`;
`install.sh --purge` also removes the bundle clone once no integration's links remain. The installer
supports `--project <dir>`, `--ref <branch|tag>` and `--from <dir>` like the other ports.

## Run

```sh
deccy-pi plan ["request"]          # planner root session
deccy-pi orchestrator ["request"]  # orchestrator root session (recommended for a round)
```

The launcher:

- validates the mode and the body of `pi/agents/deccy-<role>.md` after its frontmatter;
- exports `DECCY_ROLE`, `DECCY_ROLE_FILE`, `DECCY_BUNDLE`, `DECCY_BIN`, `DECCY_SKILLS`,
  `DECCY_AGENT_ROOT` and `DECCY_STATE`;
- selects the root tool set and adds `--name deccy-<role>`;
- loads `pi/extensions/deccy-role.ts` with `-e` and picks the approval/cwd defaults;
- passes only your arguments to Pi. The role body is **not** a user message.

`deccy-pi plan` with no request starts the Pi TUI idle. The extension adds the role body to the
root system prompt when the first turn starts, so the model sees the role and your request
together. A request passed on the command line is the first user message. A global install runs Pi
from the neutral `~/.local/share/deccy/agent` directory; a project install runs from the
project. Override the cwd with `DECCY_PI_CWD`.

Extra arguments after the mode are passed through to `pi`. `-p`/`--print` and `--mode json|rpc`
are non-interactive: they require a request argument or piped stdin and refuse to start otherwise.
Both `deccy-pi plan -p "request"` and `printf 'request\n' | deccy-pi plan -p` work.

If you run `deccy-pi orchestrator` when no approved plan exists under
`~/.local/share/deccy/agent/plan/`, it spawns the `deccy-plan` child first, shows the
layer table, and persists the approved plan to
`~/.local/share/deccy/agent/plan/<round>.plan.md` before the skeleton pass. Alternatively,
run `deccy-pi plan` first and pass the approved table into a fresh orchestrator session.

### How root role policy is applied

The launcher does **not** put an `<active_agent>` tag in the system prompt. On a non-child
`session_start`, `pi/extensions/deccy-role.ts` appends:

```ts
pi.appendEntry("active_agent", { name: "deccy-<role>" })
```

The permission system resolves that entry together with the role file's `permission:` frontmatter,
so the root gets the policy of its own agent file. The latest entry wins, so a resumed or reloaded
root re-appends the same role. An unset `DECCY_ROLE` leaves a plain `pi` session unguarded; an
invalid value is reported and appends nothing, so dispatch fails closed.

The same extension supplies the role **instructions**. On `before_agent_start` it writes the role
body to `event.systemPromptOptions.sections.deccy_role`; Pi renders that custom section after its
`<cwd>` section. The interactive TUI therefore starts idle: the prompt is built when you send the
first message, not at launch. The section is added again on every root turn, so it survives a
reload or resume.

`--append-system-prompt` is deliberately not used. Pi renders that addendum before
`<project_context>`, `<skills>` and `<cwd>`, and `@gotgenes/pi-subagents` copies the parent identity
above `<cwd>` into every child. The addendum would therefore become part of every child's prompt.
The custom section is after `<cwd>`, outside the inherited identity.

This matters because in-process children can inherit the root prompt. A tag in the prompt could be
misread as the child's role; the session entry cannot leak that way. The role section cannot leak
for the same reason it is placed last: it is not in the inherited identity, and the extension skips
it in a child.

### How child policy is applied

`@gotgenes/pi-subagents` selects `<name>.md` from `~/.pi/agent/agents/` or `<cwd>/.pi/agents/`.
Each deccy role file sets `prompt_mode: replace` and a `permission:` block. The child therefore:

- gets its own `<active_agent name="deccy-...">` system-prompt tag from the subagents package;
- gets its own `tools:` allowlist, plus the package's `ask_parent`/`notify_parent` protocol tools;
- is checked against its own path, bash and skill policy, not the root's.

The root role section is after Pi's `<cwd>`, so the child's inherited identity does not include it.
The extension also refuses to add that section in a child. A child still gets its own role body
from its `prompt_mode: replace` agent file.

The extension detects children from the `subagents:child:session-created`/`disposed` event pair and
from the session header's `parentSession`, and refuses to append a root entry in a child. A
`session_start` reason of `fork` is a user fork of the root, not a child, so it stays a root.

## Enforcement mapping

| OpenCode manifest entry | Pi mechanism |
|---|---|
| role identity (root) | `deccy-role.ts` appends the `active_agent` session entry; the launcher validates the mode and names the session |
| role identity (child) | `prompt_mode: replace` agent file plus the package's `<active_agent>` tag |
| tool availability | role `tools:` frontmatter and the launcher's `--tools` |
| `skill` allow list | `permission.skill` (`"*": deny`, then the role's two skills) |
| `subagent` allow list | `permission`/`tools` omit `subagent` for the four worker roles; `deccy-role.ts` blocks every `subagent` call except an orchestrator root naming `deccy-plan`, `deccy-gate-author`, `deccy-drafter` or `deccy-judge` |
| `edit` / `write` paths | `permission.write` / `permission.edit` path maps (last match wins) |
| shell deny/allow patterns | `permission.bash` ordered patterns (last match wins) |
| `external_directory` | explicit `external_directory: allow` and `path: allow` in every role file |
| `question` (planner/orchestrator) | `ask_user_question` when installed and UI-backed; otherwise a question in the final message |

The gate is a policy guard, not a sandbox: it constrains the tools the model can call, not the
process's filesystem access.

## Locked decisions

1. **Root policy comes from an `active_agent` session entry, not a system-prompt tag.**
   `deccy-role.ts` appends `pi.appendEntry("active_agent", { name })` rather than writing a tag into
   the root prompt, because children can inherit the root prompt.
2. **Unknown subagent types must fail closed.**
   The subagents package falls back to `general-purpose` for an unrecognized `subagent_type`.
   `deccy-role.ts` gates every call to the four worker roles, and a global install also disables the
   `general-purpose` agent in the neutral deccy cwd. Both layers are required.
3. **Package collisions are checked and refused.**
   `pi/link.sh` reads `pi list` and refuses a conflicting subagent package instead of silently
   stacking two `subagent` tools.
4. **Per-agent permission frontmatter overrides global policy, and this is documented.**
   Every role file widens `path`/`external_directory` so the round can read build caches and write
   under the agent root. That is a deliberate override of the user's global policy for the five
   `deccy-*` agent names. Per-tool path maps, ordered bash patterns and skill rules still
   enforce the role boundary.
5. **No cross-cutting `path_write` bash scoping; this is a policy guard, not a sandbox.**
   The port mirrors OpenCode/Claude/Codex: per-tool write/edit scopes, ordered bash patterns, and
   open reads. `path_write` would reject the paths written by `jj restore`, `deccy record`, test and
   build caches.
6. **No per-child `cwd`; keep the absolute-workspace-path rule.**
   Subagent children run in the parent cwd, so every packet carries the absolute workspace path and
   every shell call starts with `cd "<workspace>"`; file edits use absolute paths.
7. **`ask_user_question` is optional.**
   The launcher lists it in the root `--tools`; the tool exists only when the optional package is
   installed. Without it, or in a `-p`/JSON run, the planner and orchestrator ask in the final
   message and end the turn.
8. **Global installs run from a neutral cwd; project installs trust the project.**
   A project-local `.pi/agents/deccy-*.md` overrides the global role body and policy in
   in-process children, even when the root runs with `--no-approve`. Global installs therefore run
   Pi from `~/.local/share/deccy/agent`, which has no project `.pi/` layer. Project installs
   deliberately run from the project and trust that project's `.pi/` files. `DECCY_PI_CWD` is the
   explicit override.
9. **Root role text is a root-only system section, not a user message.**
   `deccy-role.ts` adds the body from `DECCY_ROLE_FILE` as `sections.deccy_role` in
   `before_agent_start`, which Pi renders after `<cwd>`. The interactive TUI therefore starts idle,
   and subagents do not inherit the root instructions because the package copies only the parent
   identity above `<cwd>`. `--append-system-prompt`/`--system-prompt` are deliberately not used:
   both are part of the inherited identity. Non-interactive runs need a request or piped stdin.

`DECCY_ROLE` values are validated: `plan` and `orchestrator` are accepted (with or
without the `deccy-` prefix); anything else fails closed at the subagent gate.

## Trust and approval

Pi has no per-tool hook; project trust controls whether project-local config, agents and extensions
load.

| Install | Default cwd | Approval flag | Effect |
|---|---|---|---|
| Global | `~/.local/share/deccy/agent` | `--no-approve` | Ignores any project-local `.pi/` layer; the global role files govern |
| Project | the project | `--approve` | Trusts the project's `.pi/` files, including its agent overrides |

`DECCY_PI_APPROVE=1` and `DECCY_PI_NO_APPROVE=1` override the default. An explicit `--approve` or
`--no-approve` passed through to Pi wins over both.

Approval is a trust decision, not a privilege drop: a project install trusts **every** `.pi/` file
in that project. Do not run a project-installed deccy root in a repository you do not trust. A
global install avoids the issue by running from the neutral deccy root; the round still works
because every packet uses absolute workspace paths.

## Upgrading Pi

The port depends on Pi extension APIs, the subagents tool schema and the permission-system
frontmatter parser. None is a stable public API across majors.

After a Pi or package upgrade:

```sh
pi --version
pi update --extensions     # installed packages only
# or: pi update --all      # Pi and installed packages
pi list                    # installed sources and versions
```

Then:

1. Confirm the versions: `pi --version` and `pi list`. The pin is in `pi/link.sh`; a newer Pi is
   fine, but re-check the surfaces below before trusting it.
2. Re-run the deterministic extension and launcher tests:

   ```sh
   node pi/tests/deccy-role.test.mjs
   sh pi/tests/launcher.test.sh
   ```

   The launcher test uses `script` for its PTY cases and skips those checks when `script` is not
   installed.

3. Run the guard probes and a one-unit fixture round — or at minimum:
   - a drafter write outside `workspaces/drafts/` is denied;
   - a judge write outside `workspaces/judge/` is denied;
   - an orchestrator `subagent` call to `general-purpose` or `Explore` is blocked;
   - a plan root cannot spawn at all;
   - an interactive `ask_user_question` still appears;
   - `deccy-pi plan` with no request stays idle until the first message;
   - the root prompt contains a `<deccy_role>` section after `<cwd>`, and a spawned child prompt
     contains the child role body but not the root body;
   - `deccy-pi plan -p` with a terminal stdin and no prompt exits 2.
4. Confirm the surfaces the port uses:
   - `pi.appendEntry("active_agent", { name })` still governs the active agent;
   - agent files still load from `$PI_CODING_AGENT_DIR/agents/<name>.md` and `<cwd>/.pi/agents/`;
   - the `permission:` parser still accepts nested maps, quoted `"*"` keys and comma-separated
     `tools:`;
   - the `subagent` input still uses `subagent_type`, `prompt`, `description`, `run_in_background`,
     `resume`;
   - the child lifecycle events still fire before the child's `session_start`;
   - unknown `subagent_type` still falls back to `general-purpose` (the extension must still block
     it).
5. If you move the pins, update `PKG_*` in `pi/link.sh`, re-run `link.sh`, re-run the tests, and
   change this README in the same change.

The symlinks stay live, so a bundle update only needs `git -C "$DEST_BUNDLE" pull`. A package
upgrade needs `pi remove <source>` and a fresh `./pi/link.sh` when the pin changes; `link.sh` warns
rather than replacing a package at a different version.

## Maintenance handoff

- **Role files are the source of truth.** `pi/agents/deccy-*.md` supply the root prompt body, the
  subagent definition and the permission block. Do not duplicate a role in the launcher or in
  `deccy-role.ts`.
- **Policy mirrors the other ports.** The write scopes and ordered bash patterns are the Pi
  translation of `opencode/agents/*.md` and `claude/hooks/deccy-guard.py`. Change them together.
- **Skills stay shared.** Only the Pi path list in each `skills/**/SKILL.md` is Pi-specific; the
  procedure text is common to all four ports.
- **Last validated combination.** Pi `1.5.0`, `@gotgenes/pi-subagents@25.0.5`,
  `@gotgenes/pi-permission-system@42.0.0`, optional
  `@juicesharp/rpiv-ask-user-question@2.15.0`, jj `0.46.0`, deccy `0.2.1`, macOS arm64.
- **Before handoff.** Run `node pi/tests/deccy-role.test.mjs` and `sh pi/tests/launcher.test.sh`,
  plus the guard probes and one-unit fixture round described under
  [Upgrading Pi](#upgrading-pi).

## Pi-specific caveats

- **Guard, not sandbox.** `@gotgenes/pi-permission-system` scopes tool calls. Subagent children
  inherit the parent process's filesystem access, and reads stay open. The prompts forbid reading
  another role's workspace; the permission system cannot enforce a per-role filesystem.
- **Plain `pi` is unguarded.** The root policy requires `deccy-pi` (or an explicit `DECCY_ROLE`
  plus `DECCY_ROLE_FILE` and the extension). A plain `pi` session has no deccy role and no deccy
  policy.
- **Project agent override.** A project-local `.pi/agents/deccy-*.md` with the same name replaces
  the global body and `permission:` block in children. Never run a project-installed root in an
  untrusted repository; use a global install for untrusted or third-party checkouts.
- **Extension loading.** `-e` loads the extension only in the root; the linked copy in the global
  extensions directory loads in children too. Pi dedupes the same real path, so passing `-e` and
  linking it is safe. Do not install a **copy** at a different path and also pass `-e`.
- **`external_directory` widening.** Every deccy role must allow `external_directory` and `path`
  because the agent root lives outside the project cwd. This is decision 4.
- **`ask_user_question` is TUI-only in practice.** The optional extension strips the tool when
  `ctx.hasUI` is false, so `-p`/JSON runs must ask in the final message.
- **Shared cwd.** `subagent` has no `cwd` parameter; the child inherits the root session's
  directory. A global install runs from the neutral deccy root, so packets must use absolute
  workspace paths and `cd "<workspace>"`.
- **Unknown subagent types.** The extension blocks them; the disabled `general-purpose` file is the
  second layer for global installs. `--disable-builtins` also disables `Explore` and `Plan`.
- **Conflicting subagent packages.** The first two alternatives register a competing `subagent`
  tool; the worktrees package conflicts with jj workspaces. `link.sh` refuses to link when it sees
  one, but only for packages visible to `pi list`.
- **Minimal frontmatter parser.** The permission system parses the `permission:` block with a
  minimal YAML subset: nested maps by indentation, quoted `"*"` keys, comma-separated `tools:`.
  Do not introduce flow arrays, block arrays or multi-line scalars there.
- **Pinned versions.** The port is written and tested against the pins above. A newer package can
  change the tool schema, the parser or the lifecycle order; run [Upgrading Pi](#upgrading-pi)
  before trusting an upgrade.
- **`maxConcurrent`.** `link.sh` sets `maxConcurrent` to `6` in `subagents.json` when the key is
  missing or null, so the round can run parallel components. An existing value is left alone.
- **Session naming.** The launcher sets `--name deccy-<role>`; the extension does not overwrite
  it.

### Changing the state root

All five role files anchor their write scopes to `~/.local/share/deccy/agent/`. Setting
`DECCY_AGENT_ROOT` moves the state but **not** the policy: update the `permission.write` and
`permission.edit` paths in every `pi/agents/deccy-*.md` to match, or the round will be denied at
the workspace boundary. The same caveat already applies to the OpenCode, Claude and Codex ports.

Keep the home and state root on their **canonical** paths. The permission system canonicalizes tool
paths (resolving symlinks) before matching, while a `~` pattern expands to `$HOME` as written. If
`$HOME` is reached through a symlink — macOS `TMPDIR` is `/var/...` → `/private/var/...` — an
otherwise allowed write can miss the pattern and be denied against `"*"`. Set
`DECCY_AGENT_ROOT` with `pwd -P` and invoke the launcher with a canonical `$HOME`
(`HOME=$(cd "$HOME" && pwd -P)`).
