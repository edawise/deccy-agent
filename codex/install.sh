#!/bin/sh
# Install the deccy-agent Codex bundle from GitHub.
#
# Clones the bundle (or reuses a checkout given with --from) and runs
# codex/link.sh, which symlinks the shared skills into Codex's discovery path,
# links the `deccy-codex` launcher, and registers the deccy guard hook in
# Codex's hooks.json. Then: `deccy-codex plan` / `deccy-codex orchestrator`.
#
# Usage:
#   ./install.sh                        # global install (default)
#   ./install.sh --project <dir>        # project-local links into <dir>/.agents,
#                                       # <dir>/.codex and <dir>/.codex/bin
#   ./install.sh --ref <branch|tag>     # install a specific ref (default: main)
#   ./install.sh --from <dir>           # use an existing checkout in place
#   ./install.sh --uninstall            # remove the links and the guard hook
#   ./install.sh --purge                # also remove the bundle clone
#   ./install.sh --list                 # show the links, targets and guard hook
#
# Env overrides:
#   REPO_URL     GitHub repo (default: https://github.com/edawise/deccy-agent.git)
#   DEST_BUNDLE  bundle clone (default: ~/.local/share/deccy/agent/bundle)
#   DEST_SKILLS / DEST_HOOKS / DEST_BIN  destinations passed to link.sh
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
  command -v codex >/dev/null 2>&1 || {
    echo "codex is required but was not found on PATH" >&2
    echo "install Codex CLI first: https://developers.openai.com/codex" >&2
    exit 1
  }
  MIN_CODEX=0.167.0
  CODEX_VERSION=$(codex --version 2>/dev/null | awk 'NF {print $NF; exit}')
  if ! awk -v have="${CODEX_VERSION:-0}" -v min="$MIN_CODEX" 'BEGIN {
      n = split(have, a, ".")
      m = split(min, b, ".")
      if (n < m) n = m
      for (i = 1; i <= n; i++) {
        if (a[i] + 0 > b[i] + 0) exit 0
        if (a[i] + 0 < b[i] + 0) exit 1
      }
      exit 0
    }'; then
    echo "Codex CLI $MIN_CODEX or newer is required (found: ${CODEX_VERSION:-unknown})" >&2
    echo "upgrade with: codex update" >&2
    exit 1
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
LINK="$BUNDLE/codex/link.sh"

if [ -n "$FROM" ] && [ ! -f "$LINK" ]; then
  echo "--from: $BUNDLE does not look like a deccy-agent checkout (no codex/link.sh)" >&2
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

launcher_path() {
  if [ -n "$PROJECT_DIR" ]; then
    echo "$PROJECT_DIR/.codex/bin/deccy-codex"
  else
    echo "${DEST_BIN:-$HOME/.local/bin}/deccy-codex"
  fi
}

# Collect symlinks in any integration's default destinations (plus any
# DEST_SKILLS/DEST_BIN this run was given) whose target is inside $BUNDLE.
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
  add_blockers "$HOME/.agents/skills"
  add_blockers "$HOME/.codex/bin"
  add_blockers "$HOME/.local/bin"
  if [ -n "$PROJECT_DIR" ]; then
    add_blockers "$PROJECT_DIR/.opencode/skills"
    add_blockers "$PROJECT_DIR/.opencode/agents"
    add_blockers "$PROJECT_DIR/.claude/skills"
    add_blockers "$PROJECT_DIR/.claude/agents"
    add_blockers "$PROJECT_DIR/.agents/skills"
    add_blockers "$PROJECT_DIR/.codex/bin"
  fi
  add_blockers "${DEST_SKILLS:-}"
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
    echo "it is shared by all integrations (opencode/, claude/, codex/); it was not removed."
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
    run_link --uninstall
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
    echo "bundle checkout: $BUNDLE (shared by opencode/, claude/ and codex/)"
    echo "update later with:  git -C \"$BUNDLE\" pull"
    echo "review and trust the deccy hooks in Codex with /hooks before the first run"
    echo "run:  $(launcher_path) plan   |   $(launcher_path) orchestrator"
    ;;
esac
