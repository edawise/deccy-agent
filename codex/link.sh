#!/bin/sh
# Symlink the deccy skills and launcher into Codex, and register the deccy guard
# (codex/hooks/deccy-guard.py) as a PreToolUse hook in Codex's hooks.json.
#
# Usage:
#   ./link.sh                       # global: ~/.agents/skills, ~/.codex/hooks.json,
#                                   #         ~/.local/bin/deccy-codex
#   ./link.sh --project <dir>       # <dir>/.agents/skills, <dir>/.codex/hooks.json,
#                                   #         <dir>/.codex/bin/deccy-codex
#   ./link.sh --uninstall           # remove only symlinks into this bundle, and the guard entry
#   ./link.sh --list                # show the links, their targets and the guard entry
#
# Env overrides (global mode):
#   DEST_SKILLS                     skills directory
#   DEST_HOOKS                      hooks.json file for the guard
#   DEST_BIN                        directory for the deccy-codex launcher link
#
# Skills come from the shared `<repo>/skills`; the launcher from `<repo>/codex/deccy-codex`. Role
# prompts and the guard stay in the bundle. The hooks.json file is edited in place: only the
# guard's own entry is added or removed. Codex loads project hooks only after the project `.codex/`
# layer is trusted, and global hooks only after review in `/hooks`.
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BUNDLE=$(CDPATH= cd -- "$HERE/.." && pwd)
SRC_SKILLS="$BUNDLE/skills"
SRC_LAUNCHER="$HERE/deccy-codex"
PROJECT_DIR=""
UNINSTALL=0
LIST=0

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT_DIR="${2:?--project needs a directory}"; shift 2;;
    --uninstall) UNINSTALL=1; shift;;
    --list) LIST=1; shift;;
    -h|--help) sed -n '2,21p' "$0"; exit 0;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 1;;
  esac
done

if [ -n "$PROJECT_DIR" ]; then
  DEST_SKILLS="$PROJECT_DIR/.agents/skills"
  DEST_HOOKS="$PROJECT_DIR/.codex/hooks.json"
  DEST_BIN="$PROJECT_DIR/.codex/bin"
else
  DEST_SKILLS="${DEST_SKILLS:-$HOME/.agents/skills}"
  DEST_HOOKS="${DEST_HOOKS:-$HOME/.codex/hooks.json}"
  DEST_BIN="${DEST_BIN:-$HOME/.local/bin}"
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
    "$SRC_SKILLS"/*|"$SRC_LAUNCHER") return 0;;
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
  link_one "$SRC_LAUNCHER" "$DEST_BIN/deccy-codex"
}

if [ "$LIST" -eq 1 ]; then
  link_all
  settings_hook status "$DEST_HOOKS"
  exit 0
fi

if [ "$UNINSTALL" -eq 1 ]; then
  link_all
  settings_hook uninstall "$DEST_HOOKS"
  exit 0
fi

mkdir -p "$DEST_SKILLS" "$DEST_BIN"
link_all
settings_hook install "$DEST_HOOKS" "$GUARD"

case ":$PATH:" in
  *":$DEST_BIN:"*) ;;
  *) echo "warning: $DEST_BIN is not on PATH; run $DEST_BIN/deccy-codex by absolute path" >&2;;
esac
echo "review and trust the deccy hook in Codex with /hooks before starting a session"
if [ -n "$PROJECT_DIR" ]; then
  echo "project install: add .agents/ and .codex/ to .gitignore so jj does not snapshot the symlinks"
fi
