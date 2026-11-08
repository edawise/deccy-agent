#!/bin/sh
# Install the deccy-agent Pi bundle from GitHub.
#
# Clones the bundle (or reuses a checkout given with --from) and runs
# pi/link.sh, which installs the pinned Pi packages, symlinks the shared skills,
# the five roles, the role extension and the launcher, and prepares the neutral
# deccy session root.
#
# Usage:
#   ./install.sh                        # global install (default)
#   ./install.sh --project <dir>        # project-local install into <dir>/.pi
#   ./install.sh --ref <branch|tag>     # install a specific ref (default: main)
#   ./install.sh --from <dir>           # use an existing checkout in place
#   ./install.sh --uninstall            # remove the links (with --project for local)
#   ./install.sh --purge                # remove the links and the bundle clone
#   ./install.sh --list                 # show the links, packages and safety files
#   ./install.sh --with-ask             # install the optional ask-user-question package (default)
#   ./install.sh --no-ask               # skip @juicesharp/rpiv-ask-user-question
#   ./install.sh --no-packages          # do not check or install Pi packages
#   ./install.sh --disable-builtins     # also disable Explore and Plan in the deccy root
#
# Env overrides:
#   REPO_URL     GitHub repo (default: https://github.com/edawise/deccy-agent.git)
#   DEST_BUNDLE  bundle clone (default: ~/.local/share/deccy/agent/bundle)
#   PI_AGENT_DIR / DEST_SKILLS / DEST_AGENTS / DEST_EXTENSIONS / DEST_BIN
#                destinations passed to link.sh
set -eu

REPO_URL="${REPO_URL:-https://github.com/edawise/deccy-agent.git}"
DEST_BUNDLE="${DEST_BUNDLE:-$HOME/.local/share/deccy/agent/bundle}"
REF=main
PROJECT_DIR=""
FROM=""
MODE=install
LINK_FLAGS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT_DIR="${2:?--project needs a directory}"; shift 2;;
    --ref) REF="${2:?--ref needs a branch or tag}"; shift 2;;
    --from) FROM="${2:?--from needs a directory}"; shift 2;;
    --uninstall) MODE=uninstall; shift;;
    --purge) MODE=purge; shift;;
    --list) MODE=list; shift;;
    --with-ask|--no-ask|--no-packages|--disable-builtins)
      LINK_FLAGS="${LINK_FLAGS}${LINK_FLAGS:+ }$1"; shift;;
    -h|--help) sed -n '2,26p' "$0"; exit 0;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 1;;
  esac
done

if [ "$MODE" = install ]; then
  command -v pi >/dev/null 2>&1 || {
    echo "pi is required but was not found on PATH" >&2
    echo "install Pi first: https://pi.dev" >&2
    exit 1
  }
  if [ -z "$FROM" ]; then
    command -v git >/dev/null 2>&1 || {
      echo "git is required to clone the bundle (or use --from <dir>)" >&2
      exit 1
    }
  fi
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
LINK="$BUNDLE/pi/link.sh"

if [ -n "$FROM" ] && [ ! -f "$LINK" ]; then
  echo "--from: $BUNDLE does not look like a deccy-agent checkout (no pi/link.sh)" >&2
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
    # shellcheck disable=SC2086
    sh "$LINK" --project "$PROJECT_DIR" $LINK_FLAGS "$@"
  else
    # shellcheck disable=SC2086
    sh "$LINK" $LINK_FLAGS "$@"
  fi
}

launcher_path() {
  if [ -n "$PROJECT_DIR" ]; then
    echo "$PROJECT_DIR/.pi/bin/deccy-pi"
  else
    echo "${DEST_BIN:-$HOME/.local/bin}/deccy-pi"
  fi
}

# Collect symlinks in any integration's default destinations (plus any
# DEST_* this run was given) whose target is inside $BUNDLE.
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
  add_blockers "$HOME/.pi/agent/skills"
  add_blockers "$HOME/.pi/agent/agents"
  add_blockers "$HOME/.pi/agent/extensions"
  add_blockers "$HOME/.local/bin"
  add_blockers "$HOME/.config/opencode/skills"
  add_blockers "$HOME/.config/opencode/agents"
  add_blockers "$HOME/.claude/skills"
  add_blockers "$HOME/.claude/agents"
  add_blockers "$HOME/.agents/skills"
  add_blockers "$HOME/.codex/bin"
  if [ -n "$PROJECT_DIR" ]; then
    add_blockers "$PROJECT_DIR/.pi/skills"
    add_blockers "$PROJECT_DIR/.pi/agents"
    add_blockers "$PROJECT_DIR/.pi/extensions"
    add_blockers "$PROJECT_DIR/.pi/bin"
    add_blockers "$PROJECT_DIR/.opencode/skills"
    add_blockers "$PROJECT_DIR/.opencode/agents"
    add_blockers "$PROJECT_DIR/.claude/skills"
    add_blockers "$PROJECT_DIR/.claude/agents"
    add_blockers "$PROJECT_DIR/.agents/skills"
    add_blockers "$PROJECT_DIR/.codex/bin"
  fi
  add_blockers "${DEST_SKILLS:-}"
  add_blockers "${DEST_AGENTS:-}"
  add_blockers "${DEST_EXTENSIONS:-}"
  add_blockers "${DEST_BIN:-}"
}

case "$MODE" in
  list)
    run_link --list
    ;;
  uninstall)
    run_link --uninstall
    echo
    echo "bundle checkout: $BUNDLE"
    echo "it is shared by all integrations (opencode/, claude/, codex/, pi/); it was not removed."
    echo "remove it after all are uninstalled:  sh $0 --purge"
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
    run_link --purge
    check_blockers
    if [ -n "$blockers" ]; then
      echo "refusing to remove $BUNDLE: bundle-owned symlinks remain:" >&2
      printf '%s' "$blockers" >&2
      echo "uninstall them (the other integrations' link.sh --uninstall), then re-run --purge" >&2
      exit 1
    fi
    rm -rf "$BUNDLE"
    echo "removed $BUNDLE"
    ;;
  install)
    run_link
    echo
    echo "bundle checkout: $BUNDLE (shared by opencode/, claude/, codex/ and pi/)"
    echo "update later with:  git -C \"$BUNDLE\" pull"
    echo "run:  $(launcher_path) plan   |   $(launcher_path) orchestrator"
    ;;
esac
