#!/bin/sh
# Install the deccy-agent skill and agents from GitHub.
#
# Usage:
#   ./install.sh                          # global install (default)
#   ./install.sh --project <dir>          # project-local install into <dir>/.opencode
#   ./install.sh --ref <branch|tag|sha>   # install a specific ref (default: main)
#   ./install.sh --uninstall              # remove installed files (with --project for local)
#
# Env overrides:
#   REPO_URL   GitHub repo (default: https://github.com/edawise/deccy-agent-bootstrap)
#   DEST_SKILLS / DEST_AGENTS directories (default: ~/.config/opencode/...)
set -eu

REPO_URL="${REPO_URL:-https://github.com/edawise/deccy-agent-bootstrap}"
REF="main"
PROJECT_DIR=""
UNINSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT_DIR="${2:?--project needs a directory}"; shift 2;;
    --ref) REF="${2:?--ref needs a branch, tag or sha}"; shift 2;;
    --uninstall) UNINSTALL=1; shift;;
    -h|--help) sed -n '2,12p' "$0"; exit 0;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 1;;
  esac
done

if [ -n "$PROJECT_DIR" ]; then
  DEST_SKILLS="$PROJECT_DIR/.opencode/skills"
  DEST_AGENTS="$PROJECT_DIR/.opencode/agents"
else
  DEST_SKILLS="${DEST_SKILLS:-$HOME/.config/opencode/skills}"
  DEST_AGENTS="${DEST_AGENTS:-$HOME/.config/opencode/agents}"
fi

SKILL_DEST="$DEST_SKILLS/deccy-agent"
AGENT_DEST="$DEST_AGENTS/deccy-agent.md"
PLAN_DEST="$DEST_AGENTS/deccy-plan.md"

if [ "$UNINSTALL" -eq 1 ]; then
  rm -rf "$SKILL_DEST" "$AGENT_DEST" "$PLAN_DEST"
  echo "removed $SKILL_DEST, $AGENT_DEST and $PLAN_DEST"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone --quiet --depth 1 --branch "$REF" "$REPO_URL" "$TMP/repo" 2>/dev/null \
  || { git clone --quiet "$REPO_URL" "$TMP/repo" && git -C "$TMP/repo" checkout --quiet "$REF"; }

mkdir -p "$DEST_SKILLS" "$DEST_AGENTS"
rm -rf "$SKILL_DEST"
cp -r "$TMP/repo/skills/deccy-agent" "$SKILL_DEST"
cp "$TMP/repo/agents/deccy-agent.md" "$AGENT_DEST"
cp "$TMP/repo/agents/deccy-plan.md" "$PLAN_DEST"

echo "installed skill -> $SKILL_DEST"
echo "installed agent -> $AGENT_DEST"
echo "installed agent -> $PLAN_DEST"
