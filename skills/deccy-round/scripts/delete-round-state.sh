#!/bin/sh
# Delete one round's ROUND.md ledger.
#
# The round ledger is live work state, not audit: the orchestrator deletes it after the
# close report and the user's approval. This script is the orchestrator's only delete
# path for round state. It refuses:
#   - a missing or malformed round id;
#   - a path outside $ROOT/rounds/;
#   - a symlinked round directory.
# It removes ROUND.md and then the round directory only if that directory is empty.
# It never deletes a workspace, a node, or anything outside the round's own directory.
#
# Usage: delete-round-state.sh <round-id>

set -eu

ROUND="${1:-}"
ROOT="${DECCY_AGENT_ROOT:-$HOME/.local/share/deccy/agent}"

case "$ROUND" in
  ''|*/*|.|..)
    echo "usage: $0 <round-id>" >&2
    exit 2
    ;;
esac

DIR="$ROOT/rounds/$ROUND"

if [ -L "$DIR" ]; then
  echo "delete-round-state: refusing symlinked round directory: $DIR" >&2
  exit 1
fi

if [ ! -d "$DIR" ]; then
  echo "delete-round-state: no such round: $ROUND" >&2
  exit 1
fi

rm -f "$DIR/ROUND.md"
echo "delete-round-state: removed $DIR/ROUND.md"

if [ -z "$(ls -A "$DIR" 2>/dev/null)" ]; then
  rmdir "$DIR" 2>/dev/null || true
  echo "delete-round-state: removed empty round directory $DIR"
else
  echo "delete-round-state: kept $DIR (other files remain)"
fi
