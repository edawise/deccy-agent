#!/bin/sh
# Run one of the two deccy primary sessions in Claude Code.
#
# Usage:
#   ./run.sh [--mode append|agent] <plan|orchestrator> ["<request>"] [-- extra claude args]
#   ./run.sh plan "Plan the next layer for <request>"
#   ./run.sh orchestrator                    # interactive
#   ./run.sh orchestrator -- --permission-mode acceptEdits
#   ./run.sh --mode agent orchestrator       # start the session *as* the agent file
#   ./run.sh plan --print-prompt             # print the system prompt, run nothing
#
# Modes (default: append, or $DECCY_CLAUDE_MODE):
#   append  Claude Code's default system prompt plus the agent body (--append-system-prompt);
#           the agent's `tools:` line is applied with --tools. Runs from a checkout, no install.
#   agent   `claude --agent deccy-<role>`: the agent body *replaces* Claude Code's default system
#           prompt, and Claude Code applies the `tools:` line itself, including the
#           Agent(...) allow list. The agents must be linked (link.sh / install.sh).
#
# Both modes load claude/hooks/deccy-guard.py as a PreToolUse hook (--settings). It applies the
# OpenCode per-role permission lists to this session and to every deccy subagent it spawns.
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
GUARD="$HERE/hooks/deccy-guard.py"

usage() {
  sed -n '2,20p' "$0" >&2
  exit 2
}

MODE="${DECCY_CLAUDE_MODE:-append}"
if [ "${1:-}" = "--mode" ]; then
  MODE="${2:?--mode needs append or agent}"
  shift 2
fi
case "$MODE" in
  append|agent) ;;
  *) echo "unknown mode: $MODE (expected append or agent)" >&2; usage;;
esac

[ $# -ge 1 ] || usage
ROLE=$1
shift

case "$ROLE" in
  plan|orchestrator) ;;
  *) echo "unknown role: $ROLE (expected plan or orchestrator)" >&2; usage;;
esac

AGENT="$HERE/agents/deccy-$ROLE.md"
[ -f "$AGENT" ] || { echo "missing agent file: $AGENT" >&2; exit 1; }

PRINT=0
REQ=""
case "${1:-}" in
  --print-prompt) PRINT=1; shift;;
  --) shift;;
  "") ;;
  *) REQ=$1; shift;;
esac
[ "${1:-}" = "--" ] && shift

# The body is everything after the closing frontmatter fence.
BODY=$(awk '
  NR == 1 && $0 == "---" { fm = 1; next }
  fm == 1 && $0 == "---" { fm = 2; next }
  fm != 1 { print }
' "$AGENT" | sed '/./,$!d')

if [ "$PRINT" -eq 1 ]; then
  printf '%s\n' "$BODY"
  exit 0
fi

command -v python3 >/dev/null 2>&1 || {
  echo "python3 is required for the deccy guard hook" >&2
  exit 1
}
[ -f "$GUARD" ] || { echo "missing guard: $GUARD" >&2; exit 1; }

# The `tools:` frontmatter line as a --tools list: Agent(a, b) -> Agent, Task -> Agent.
TOOLS=$(awk '
  NR == 1 && $0 == "---" { fm = 1; next }
  fm == 1 && $0 == "---" { exit }
  fm == 1 && /^tools:/ { sub(/^tools:[ \t]*/, ""); print; exit }
' "$AGENT" | sed -e 's/([^)]*)//g' -e 's/[[:space:]]//g' | tr ',' '\n' \
  | sed 's/^Task$/Agent/' | paste -sd, -)
[ -n "$TOOLS" ] || { echo "no tools: line in $AGENT" >&2; exit 1; }

# A failing or missing guard blocks (exit 2) rather than letting the call through.
json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
HOOK_CMD="python3 '$GUARD' --main-role deccy-$ROLE || exit 2"
SETTINGS=$(printf '{"hooks":{"PreToolUse":[{"matcher":"*","hooks":[{"type":"command","command":"%s"}]}]}}' \
  "$(json_escape "$HOOK_CMD")")

# Positional parameters inside a function are local, so this prepends our flags to the
# caller's extra claude arguments without losing them.
invoke() {
  if [ "$MODE" = agent ]; then
    set -- --agent "deccy-$ROLE" --settings "$SETTINGS" "$@"
  else
    set -- --append-system-prompt "$BODY" --tools "$TOOLS" --settings "$SETTINGS" "$@"
  fi
  if [ -n "$REQ" ]; then
    exec claude "$@" -p "$REQ"
  fi
  exec claude "$@"
}

invoke "$@"
