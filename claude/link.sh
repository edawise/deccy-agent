#!/bin/sh
# Symlink the deccy skills and Claude Code agents into Claude Code, and register the deccy guard
# (claude/hooks/deccy-guard.py) as a PreToolUse hook in Claude Code's settings.
#
# Usage:
#   ./link.sh                       # global: ~/.claude/{skills,agents}, ~/.claude/settings.json
#   ./link.sh --project <dir>       # <dir>/.claude/{skills,agents}, <dir>/.claude/settings.local.json
#   ./link.sh --uninstall           # remove only symlinks into this bundle, and the guard entry
#   ./link.sh --list                # show the links, their targets and the guard entry
#
# Env overrides:
#   DEST_SKILLS / DEST_AGENTS       destination directories
#   DEST_SETTINGS                   settings file for the guard hook
#
# Skills come from the shared `<repo>/skills`; agents from `<repo>/claude/agents`. The settings
# file is edited in place: only the guard's own entry is added or removed.
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BUNDLE=$(CDPATH= cd -- "$HERE/.." && pwd)
SRC_SKILLS="$BUNDLE/skills"
SRC_AGENTS="$HERE/agents"
PROJECT_DIR=""
UNINSTALL=0
LIST=0

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT_DIR="${2:?--project needs a directory}"; shift 2;;
    --uninstall) UNINSTALL=1; shift;;
    --list) LIST=1; shift;;
    -h|--help) sed -n '2,17p' "$0"; exit 0;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 1;;
  esac
done

if [ -n "$PROJECT_DIR" ]; then
  DEST_SKILLS="$PROJECT_DIR/.claude/skills"
  DEST_AGENTS="$PROJECT_DIR/.claude/agents"
  DEST_SETTINGS="$PROJECT_DIR/.claude/settings.local.json"
else
  DEST_SKILLS="${DEST_SKILLS:-$HOME/.claude/skills}"
  DEST_AGENTS="${DEST_AGENTS:-$HOME/.claude/agents}"
  DEST_SETTINGS="${DEST_SETTINGS:-$HOME/.claude/settings.json}"
fi
GUARD="$HERE/hooks/deccy-guard.py"
SETTINGS_HOOK="$HERE/hooks/settings-hook.py"

settings_hook() {
  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 is required for the deccy guard hook (and the deccy check scripts)" >&2
    exit 1
  fi
  python3 "$SETTINGS_HOOK" "$@"
}

is_ours() {
  target=$(readlink "$1")
  case "$target" in
    "$SRC_SKILLS"/*|"$SRC_AGENTS"/*) return 0;;
    *) return 1;;
  esac
}

link_one() {
  src=$1
  dest=$2

  if [ "$LIST" -eq 1 ]; then
    if [ -L "$dest" ] && is_ours "$dest"; then
      echo "$dest -> $(readlink "$dest")"
    else
      echo "$dest (not linked)"
    fi
    return
  fi

  if [ "$UNINSTALL" -eq 1 ]; then
    if [ -L "$dest" ] && is_ours "$dest"; then
      rm "$dest"
      echo "unlinked $dest"
    fi
    return
  fi

  if [ -L "$dest" ]; then
    if is_ours "$dest"; then
      rm "$dest"
    else
      echo "refusing to replace $dest (points to $(readlink "$dest"))" >&2
      exit 1
    fi
  elif [ -e "$dest" ]; then
    echo "refusing to replace $dest (exists and is not a symlink)" >&2
    exit 1
  fi

  ln -s "$src" "$dest"
  echo "linked $dest -> $src"
}

link_all() {
  for src in "$SRC_SKILLS"/*; do
    [ -d "$src" ] || continue
    link_one "$src" "$DEST_SKILLS/$(basename "$src")"
  done
  for src in "$SRC_AGENTS"/*.md; do
    [ -f "$src" ] || continue
    link_one "$src" "$DEST_AGENTS/$(basename "$src")"
  done
}

if [ "$LIST" -eq 1 ]; then
  link_all
  settings_hook status "$DEST_SETTINGS"
  exit 0
fi

if [ "$UNINSTALL" -eq 1 ]; then
  link_all
  settings_hook uninstall "$DEST_SETTINGS"
  exit 0
fi

mkdir -p "$DEST_SKILLS" "$DEST_AGENTS"
link_all
settings_hook install "$DEST_SETTINGS" "$GUARD"
