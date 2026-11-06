# deccy agent — OpenCode

OpenCode-specific paths, invocation and enforcement for the deccy agent bundle. See the root
[`README.md`](../README.md) for the shared round protocol, roles, installer options and
limitations.

## Paths & verify

`opencode/link.sh` (and `opencode/install.sh`) symlinks the five skills and five agents into:

- **Global (default):** `~/.config/opencode/skills/deccy-*` and `~/.config/opencode/agents/deccy-*.md`
- **Project (`--project <dir>`):** `<dir>/.opencode/skills` and `<dir>/.opencode/agents`

Verify the links:

```sh
opencode debug agents | grep deccy
ls -la ~/.config/opencode/skills/deccy-*
```

## Run

```sh
opencode run --agent deccy-plan "Plan the next layer for <request>"
opencode run --agent deccy-orchestrator "Execute the approved layer plan"
```

Approved plans are read and written under `~/.opencode/plan/*`.

## Enforcement

OpenCode enforces each role's allowed tools, skills, subagents, edit paths and shell patterns
directly from the `permissions:` frontmatter in `opencode/agents/*.md`.
