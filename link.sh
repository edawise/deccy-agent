#!/bin/sh
# Symlink the deccy skills and agents into OpenCode.
#
# Usage:
#   ./link.sh                       # global: ~/.config/opencode/{skills,agents}
#   ./link.sh --project <dir>       # <dir>/.opencode/{skills,agents}
#   ./link.sh --uninstall           # remove only symlinks into this bundle
#   ./link.sh --list                # show the links and their targets
#
# Env overrides:
#   DEST_SKILLS / DEST_AGENTS       destination directories
set -eu

SRC=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=""
UNINSTALL=0
LIST=0

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT_DIR="${2:?--project needs a directory}"; shift 2;;
    --uninstall) UNINSTALL=1; shift;;
    --list) LIST=1; shift;;
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

is_ours() {
  target=$(readlink "$1")
  case "$target" in
    "$SRC"/*) return 0;;
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

if [ "$UNINSTALL" -eq 1 ] || [ "$LIST" -eq 1 ]; then
  for src in "$SRC"/skills/*; do
    [ -d "$src" ] || continue
    link_one "$src" "$DEST_SKILLS/$(basename "$src")"
  done
  for src in "$SRC"/agents/*.md; do
    [ -f "$src" ] || continue
    link_one "$src" "$DEST_AGENTS/$(basename "$src")"
  done
  exit 0
fi

mkdir -p "$DEST_SKILLS" "$DEST_AGENTS"

for src in "$SRC"/skills/*; do
  [ -d "$src" ] || continue
  link_one "$src" "$DEST_SKILLS/$(basename "$src")"
done
for src in "$SRC"/agents/*.md; do
  [ -f "$src" ] || continue
  link_one "$src" "$DEST_AGENTS/$(basename "$src")"
done
