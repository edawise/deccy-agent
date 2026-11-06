#!/bin/sh
# Install the deccy-agent Claude Code bundle from GitHub.
#
# Clones the bundle (or reuses a checkout given with --from) and runs
# claude/link.sh, which symlinks the five skills and five agents into
# Claude Code's discovery paths and registers the deccy guard hook in
# Claude Code's settings. Then: `claude --agent deccy-plan` /
# `claude --agent deccy-orchestrator`.
#
# Usage:
#   ./install.sh                        # global install (default)
#   ./install.sh --project <dir>        # project-local links into <dir>/.claude
#   ./install.sh --ref <branch|tag>     # install a specific ref (default: main)
#   ./install.sh --from <dir>           # use an existing checkout in place
#   ./install.sh --uninstall            # remove the links and the guard hook
#   ./install.sh --purge                # also remove the bundle clone
#   ./install.sh --list                 # show the links, targets and the guard hook
#
# Env overrides:
#   REPO_URL     GitHub repo (default: https://github.com/edawise/deccy-agent.git)
#   DEST_BUNDLE  bundle clone (default: ~/.local/share/deccy/agent/bundle)
#   DEST_SKILLS / DEST_AGENTS / DEST_SETTINGS  destinations passed to link.sh
set -eu

REPO_URL="${REPO_URL:-https://github.com/edawise/deccy-agent.git}"
DEST_BUNDLE="${DEST_BUNDLE:-$HOME/.local/share/deccy/agent/bundle}"
REF=main
PROJECT_DIR=""
FROM=""
MODE=install

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT_DIR="${2:?--project needs a directory}"; shift 2;;
    --ref) REF="${2:?--ref needs a branch or tag}"; shift 2;;
    --from) FROM="${2:?--from needs a directory}"; shift 2;;
    --uninstall) MODE=uninstall; shift;;
    --purge) MODE=purge; shift;;
    --list) MODE=list; shift;;
    -h|--help) sed -n '2,22p' "$0"; exit 0;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 1;;
  esac
done

if [ "$MODE" = install ]; then
  command -v claude >/dev/null 2>&1 || {
    echo "claude is required but was not found on PATH" >&2
    echo "install Claude Code first: https://docs.claude.com/en/docs/claude-code" >&2
    exit 1
  }
  command -v jj >/dev/null 2>&1 || echo "warning: jj not found on PATH; deccy rounds need it" >&2
  command -v deccy >/dev/null 2>&1 || echo "warning: deccy not found on PATH; graph writes need it" >&2
fi

if [ -n "$FROM" ]; then
  BUNDLE=$(CDPATH= cd -- "$FROM" 2>/dev/null && pwd) || {
    echo "--from: no such directory: $FROM" >&2
    exit 1
  }
else
  BUNDLE=$DEST_BUNDLE
fi
LINK="$BUNDLE/claude/link.sh"

if [ -n "$FROM" ] && [ ! -f "$LINK" ]; then
  echo "--from: $BUNDLE does not look like a deccy-agent checkout (no claude/link.sh)" >&2
  exit 1
fi

if [ "$MODE" = install ] && [ -z "$FROM" ]; then
  if [ -e "$BUNDLE" ]; then
    if [ -f "$LINK" ]; then
      echo "refusing to reinstall: $BUNDLE already exists" >&2
      echo "update it in place (the symlinks stay live):  git -C \"$BUNDLE\" pull" >&2
      echo "or use an existing checkout:                  sh $0 --from <dir>" >&2
    else
      echo "refusing: $BUNDLE exists but is not a deccy-agent checkout" >&2
      echo "move it aside, or set DEST_BUNDLE to another path" >&2
    fi
    exit 1
  fi
  mkdir -p "$(dirname -- "$BUNDLE")"
  echo "cloning $REPO_URL ($REF) -> $BUNDLE"
  git clone --quiet --depth 1 --branch "$REF" "$REPO_URL" "$BUNDLE"
fi

if [ "$MODE" != install ] && [ ! -f "$LINK" ]; then
  echo "no deccy bundle at $BUNDLE; nothing to $MODE"
  exit 0
fi

run_link() {
  if [ -n "$PROJECT_DIR" ]; then
    sh "$LINK" --project "$PROJECT_DIR" "$@"
  else
    sh "$LINK" "$@"
  fi
}

# Collect symlinks in either integration's default destinations (plus any
# DEST_SKILLS/DEST_AGENTS this run was given) whose target is inside $BUNDLE.
blockers=""
add_blockers() {
  dir=$1
  [ -n "$dir" ] || return 0
  [ -d "$dir" ] || return 0
  for entry in "$dir"/*; do
    [ -L "$entry" ] || continue
    target=$(readlink "$entry")
    case "$target" in
      "$BUNDLE"/*) blockers="${blockers}  $entry -> $target
";;
    esac
  done
}

check_blockers() {
  add_blockers "$HOME/.config/opencode/skills"
  add_blockers "$HOME/.config/opencode/agents"
  add_blockers "$HOME/.claude/skills"
  add_blockers "$HOME/.claude/agents"
  add_blockers "${DEST_SKILLS:-}"
  add_blockers "${DEST_AGENTS:-}"
}

case "$MODE" in
  list)
    run_link --list
    ;;
  uninstall)
    run_link --uninstall
    echo
    echo "bundle checkout: $BUNDLE"
    echo "it is shared by both integrations (opencode/ and claude/); it was not removed."
    echo "remove it after both are uninstalled:  sh $0 --purge"
    ;;
  purge)
    if [ -n "$FROM" ]; then
      echo "refusing to --purge a checkout given with --from: $BUNDLE" >&2
      exit 1
    fi
    case "$BUNDLE" in
      /|"$HOME") echo "refusing to --purge unsafe path: $BUNDLE" >&2; exit 1;;
      /*) ;;
      *) echo "refusing to --purge a non-absolute path: $BUNDLE" >&2; exit 1;;
    esac
    run_link --uninstall
    check_blockers
    if [ -n "$blockers" ]; then
      echo "refusing to remove $BUNDLE: bundle-owned symlinks remain:" >&2
      printf '%s' "$blockers" >&2
      echo "uninstall them (the other integration's link.sh --uninstall), then re-run --purge" >&2
      exit 1
    fi
    rm -rf "$BUNDLE"
    echo "removed $BUNDLE"
    ;;
  install)
    run_link
    echo
    echo "bundle checkout: $BUNDLE (shared by opencode/ and claude/)"
    echo "update later with:  git -C \"$BUNDLE\" pull"
    echo "run:  claude --agent deccy-plan   |   claude --agent deccy-orchestrator"
    ;;
esac
