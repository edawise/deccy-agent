#!/bin/sh
# Run one of the two deccy primary sessions in Claude Code.
#
# Claude Code cannot be started *as* an agent file, so this launcher appends the agent body
# as a system prompt instead. That is the "mode: all" equivalent of the root bundle, where a
# primary agent is started as a session.
#
# Usage:
#   ./run.sh <plan|orchestrator> ["<request>"] [-- extra claude args]
#   ./run.sh plan "Plan the next layer for <request>"
#   ./run.sh orchestrator                    # interactive
#   ./run.sh orchestrator -- --permission-mode acceptEdits
#   ./run.sh plan --print-prompt             # print the system prompt, run nothing
#
# The `plan` session also passes --disallowedTools "Write,Edit".
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

usage() {
  sed -n '2,15p' "$0" >&2
  exit 2
}

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

# Positional parameters inside a function are local, so this prepends our flags to the
# caller's extra claude arguments without losing them.
invoke() {
  if [ "$ROLE" = plan ]; then
    set -- --disallowedTools "Write,Edit" "$@"
  fi
  if [ -n "$REQ" ]; then
    exec claude --append-system-prompt "$BODY" "$@" -p "$REQ"
  fi
  exec claude --append-system-prompt "$BODY" "$@"
}

invoke "$@"
