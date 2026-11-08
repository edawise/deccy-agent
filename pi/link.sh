#!/bin/sh
# Symlink the deccy skills, agents, role extension and launcher into Pi, install
# the pinned Pi packages, and prepare the deccy session root.
#
# Usage:
#   ./link.sh                       # global: ~/.pi/agent/{skills,agents,extensions},
#                                   #         ~/.local/bin/deccy-pi
#   ./link.sh --project <dir>       # <dir>/.pi/{skills,agents,extensions,bin}
#   ./link.sh --list                # show the links, packages and safety files
#   ./link.sh --uninstall           # remove only links/files created by this bundle
#   ./link.sh --purge               # uninstall, then remove the disabled-builtin files
#
# Package flags:
#   --with-ask                      install @juicesharp/rpiv-ask-user-question (default)
#   --no-ask                        skip the optional ask-user-question package
#   --no-packages                   do not check or install any Pi package
#   --disable-builtins              also disable Explore and Plan in the deccy root
#
# Env overrides (global mode):
#   PI_AGENT_DIR               Pi agent directory (default: $PI_CODING_AGENT_DIR or ~/.pi/agent)
#   DEST_SKILLS / DEST_AGENTS / DEST_EXTENSIONS / DEST_BIN   destination directories
#   DECCY_AGENT_ROOT           deccy state root (default: ~/.local/share/deccy/agent)
#
# Skills come from the shared `<repo>/skills`; agents, the extension and the launcher come from
# `<repo>/pi`. The global install also writes a disabled `general-purpose` agent into the neutral
# deccy cwd so an unknown subagent type fails closed there (see pi/README.md, decision 2).
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BUNDLE=$(CDPATH= cd -- "$HERE/.." && pwd)
SRC_SKILLS="$BUNDLE/skills"
SRC_AGENTS="$HERE/agents"
SRC_EXTENSION="$HERE/extensions/deccy-role.ts"
SRC_LAUNCHER="$HERE/deccy-pi"

PROJECT_DIR=""
MODE=install
WITH_ASK=1
WITH_PACKAGES=1
DISABLE_BUILTINS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT_DIR="${2:?--project needs a directory}"; shift 2;;
    --list) MODE=list; shift;;
    --uninstall) MODE=uninstall; shift;;
    --purge) MODE=purge; shift;;
    --with-ask) WITH_ASK=1; shift;;
    --no-ask) WITH_ASK=0; shift;;
    --no-packages) WITH_PACKAGES=0; shift;;
    --disable-builtins) DISABLE_BUILTINS=1; shift;;
    -h|--help) sed -n '2,26p' "$0"; exit 0;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 1;;
  esac
done

AGENT_ROOT="${DECCY_AGENT_ROOT:-$HOME/.local/share/deccy/agent}"

if [ -n "$PROJECT_DIR" ]; then
  PROJECT_DIR=$(CDPATH= cd -- "$PROJECT_DIR" 2>/dev/null && pwd) || {
    echo "--project: no such directory: $PROJECT_DIR" >&2
    exit 1
  }
  DEST_SKILLS="${DEST_SKILLS:-$PROJECT_DIR/.pi/skills}"
  DEST_AGENTS="${DEST_AGENTS:-$PROJECT_DIR/.pi/agents}"
  DEST_EXTENSIONS="${DEST_EXTENSIONS:-$PROJECT_DIR/.pi/extensions}"
  DEST_BIN="${DEST_BIN:-$PROJECT_DIR/.pi/bin}"
  SUBAGENTS_JSON="$PROJECT_DIR/.pi/subagents.json"
  PI_LIST_DIR="$PROJECT_DIR"
  PI_LIST_FLAGS="--approve"
  PI_INSTALL_FLAGS="-l --approve"
  INSTALL_SCOPE="project"
else
  PI_DIR="${PI_AGENT_DIR:-${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}}"
  DEST_SKILLS="${DEST_SKILLS:-$PI_DIR/skills}"
  DEST_AGENTS="${DEST_AGENTS:-$PI_DIR/agents}"
  DEST_EXTENSIONS="${DEST_EXTENSIONS:-$PI_DIR/extensions}"
  DEST_BIN="${DEST_BIN:-$HOME/.local/bin}"
  SUBAGENTS_JSON="$PI_DIR/subagents.json"
  # A neutral cwd keeps project-local .pi/agents and .pi/extensions out of the check.
  PI_LIST_DIR="$AGENT_ROOT"
  PI_LIST_FLAGS="--no-approve"
  PI_INSTALL_FLAGS="--no-approve"
  INSTALL_SCOPE="global"
fi

# Exact pins. Keep in sync with the table in pi/README.md and re-check them with
# `pi list` / `npm view` before changing either; see "Upgrading Pi" there.
PKG_SUBAGENTS_BASE="npm:@gotgenes/pi-subagents"
PKG_PERMISSIONS_BASE="npm:@gotgenes/pi-permission-system"
PKG_ASK_BASE="npm:@juicesharp/rpiv-ask-user-question"
PKG_SUBAGENTS="$PKG_SUBAGENTS_BASE@25.0.5"
PKG_PERMISSIONS="$PKG_PERMISSIONS_BASE@42.0.0"
PKG_ASK="$PKG_ASK_BASE@2.15.0"
MIN_PI="1.0.0"

SAFETY_MARKER="Managed by deccy-agent pi/link.sh"
ALL_SAFETY_AGENTS="general-purpose Explore Plan"
SAFETY_AGENTS="general-purpose"
if [ "$DISABLE_BUILTINS" -eq 1 ]; then
  SAFETY_AGENTS="$ALL_SAFETY_AGENTS"
fi

is_ours() {
  target=$(readlink "$1" 2>/dev/null) || return 1
  case "$target" in
    "$SRC_SKILLS"/*|"$SRC_AGENTS"/*) return 0;;
    "$SRC_EXTENSION"|"$SRC_LAUNCHER") return 0;;
    *) return 1;;
  esac
}

link_one() {
  src=$1
  dest=$2

  if [ "$MODE" = list ]; then
    if [ -L "$dest" ] && is_ours "$dest"; then
      echo "$dest -> $(readlink "$dest")"
    elif [ -e "$dest" ]; then
      echo "$dest (exists, not linked by this bundle)"
    else
      echo "$dest (not linked)"
    fi
    return
  fi

  if [ "$MODE" = uninstall ] || [ "$MODE" = purge ]; then
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
  if [ -d "$SRC_SKILLS" ]; then
    for src in "$SRC_SKILLS"/*; do
      [ -d "$src" ] || continue
      link_one "$src" "$DEST_SKILLS/$(basename "$src")"
    done
  elif [ "$MODE" = install ]; then
    echo "warning: $SRC_SKILLS is missing; skills not linked" >&2
  fi

  if [ -d "$SRC_AGENTS" ]; then
    for src in "$SRC_AGENTS"/*.md; do
      [ -f "$src" ] || continue
      link_one "$src" "$DEST_AGENTS/$(basename "$src")"
    done
  elif [ "$MODE" = install ]; then
    echo "warning: $SRC_AGENTS is missing; agents not linked" >&2
  fi

  if [ -f "$SRC_EXTENSION" ]; then
    link_one "$SRC_EXTENSION" "$DEST_EXTENSIONS/deccy-role.ts"
  elif [ "$MODE" = install ]; then
    echo "warning: $SRC_EXTENSION is missing; role extension not linked" >&2
  fi

  if [ -f "$SRC_LAUNCHER" ]; then
    link_one "$SRC_LAUNCHER" "$DEST_BIN/deccy-pi"
  elif [ "$MODE" = install ]; then
    echo "warning: $SRC_LAUNCHER is missing; launcher not linked" >&2
  fi
}

run_pi_list() {
  dir=$PI_LIST_DIR
  [ -d "$dir" ] || dir=$HOME
  # shellcheck disable=SC2086
  (cd "$dir" && pi list $PI_LIST_FLAGS 2>/dev/null) || true
}

pi_version_ok() {
  have=$(pi --version 2>/dev/null | awk 'NF {print $NF; exit}' | sed 's/^v//') || have=""
  [ -n "$have" ] || return 1
  awk -v have="$have" -v min="$MIN_PI" 'BEGIN {
    n = split(have, a, ".")
    m = split(min, b, ".")
    if (n < m) n = m
    for (i = 1; i <= n; i++) {
      if ((a[i] + 0) > (b[i] + 0)) exit 0
      if ((a[i] + 0) < (b[i] + 0)) exit 1
    }
    exit 0
  }'
}

conflicting_packages() {
  run_pi_list | awk '
    /^[[:space:]]*(npm:|github:|git:|https?:|ssh:|file:)/ {
      src = $1
      if (src ~ /pi-subagents/ && src !~ /npm:@gotgenes\/pi-subagents(@|$)/) print src
    }
  '
}

have_pkg() {
  base=$1
  run_pi_list | awk -v base="$base" '
    {
      src = $1
      if (src == base || index(src, base "@") == 1) { found = 1 }
    }
    END { exit(found ? 0 : 1) }
  '
}

pkg_version() {
  base=$1
  run_pi_list | awk -v base="$base" '
    index($1, base "@") == 1 { print substr($1, length(base) + 2); exit }
  '
}

install_pkg() {
  spec=$1
  base=$2
  if have_pkg "$base"; then
    version=$(pkg_version "$base")
    pinned=${spec#"$base@"}
    if [ -n "$version" ] && [ "$version" != "$pinned" ]; then
      echo "warning: $base is $version, expected $pinned; leaving it unchanged" >&2
    fi
    return 0
  fi
  echo "installing $spec"
  # shellcheck disable=SC2086
  (cd "$PI_LIST_DIR" && pi install "$spec" $PI_INSTALL_FLAGS)
}

check_conflicts() {
  conflicts=$(conflicting_packages)
  if [ -n "$conflicts" ]; then
    echo "refusing to install: a conflicting subagent package is already configured:" >&2
    printf '  %s\n' $conflicts >&2
    echo >&2
    echo "deccy requires @gotgenes/pi-subagents and must not be combined with" >&2
    echo "nicobailon/pi-subagents, @tintinweb/pi-subagents or @gotgenes/pi-subagents-worktrees." >&2
    echo "remove the conflicting package first:  pi remove <source>" >&2
    exit 1
  fi
}

merge_subagents_json() {
  path=$1
  python3 - "$path" <<'PY'
import json
import os
import sys

path = sys.argv[1]
default = 6
data = {}
if os.path.exists(path):
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception as exc:  # noqa: BLE001 - a warning is the contract
        print(f"warning: not touching malformed {path}: {exc}", file=sys.stderr)
        raise SystemExit(0)
    if not isinstance(data, dict):
        print(f"warning: not touching {path}: top level is not an object", file=sys.stderr)
        raise SystemExit(0)
if "maxConcurrent" not in data or data["maxConcurrent"] is None:
    data["maxConcurrent"] = default
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")
    os.replace(tmp, path)
    print(f"set maxConcurrent={default} in {path}")
else:
    print(f"kept maxConcurrent={data['maxConcurrent']} in {path}")
PY
}

safety_path() {
  echo "$AGENT_ROOT/.pi/agents/$1.md"
}

safety_owned() {
  path=$1
  [ -f "$path" ] && grep -Fq "$SAFETY_MARKER" "$path" 2>/dev/null
}

write_safety_agent() {
  name=$1
  path=$(safety_path "$name")
  if [ -e "$path" ] && ! safety_owned "$path"; then
    echo "refusing to replace $path (exists and is not managed by this bundle)" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$path")"
  cat > "$path" <<EOF
---
description: Disabled $name fallback for deccy sessions
enabled: false
---

$SAFETY_MARKER. Safe to delete after uninstalling the Pi port.
EOF
  echo "wrote $path"
}

remove_safety_agents() {
  # Always attempt all managed names: the uninstall flags need not match the install flags.
  for name in $ALL_SAFETY_AGENTS; do
    path=$(safety_path "$name")
    if safety_owned "$path"; then
      rm "$path"
      echo "removed $path"
    fi
  done
}

print_packages() {
  echo "Pi packages ($INSTALL_SCOPE):"
  run_pi_list | sed 's/^/  /'
}

print_state() {
  if [ -n "$PROJECT_DIR" ]; then
    echo "package scope:  $PROJECT_DIR (project)"
  else
    echo "Pi agent dir:   $PI_DIR"
    echo "neutral cwd:    $AGENT_ROOT"
  fi
  echo "skills:         $DEST_SKILLS"
  echo "agents:         $DEST_AGENTS"
  echo "extensions:     $DEST_EXTENSIONS"
  echo "launcher:       $DEST_BIN/deccy-pi"
  echo "state root:     $AGENT_ROOT"
  echo "subagents:      $SUBAGENTS_JSON"
  if [ -z "$PROJECT_DIR" ]; then
    echo "safety files:"
    for name in $ALL_SAFETY_AGENTS; do
      path=$(safety_path "$name")
      if safety_owned "$path"; then
        echo "  $path (managed)"
      else
        echo "  $path (not created by this bundle)"
      fi
    done
  fi
}

case "$MODE" in
  list)
    echo "deccy Pi port ($INSTALL_SCOPE)"
    echo
    print_state
    echo
    link_all
    echo
    print_packages
    ;;
  uninstall|purge)
    link_all
    if [ -z "$PROJECT_DIR" ]; then
      remove_safety_agents
    fi
    echo
    echo "Pi packages were left installed; remove them with:  pi remove <source>"
    if [ "$MODE" = purge ] && [ -z "$PROJECT_DIR" ]; then
      rmdir "$AGENT_ROOT/.pi/agents" 2>/dev/null || true
      rmdir "$AGENT_ROOT/.pi" 2>/dev/null || true
      echo "removed the deccy disabled-builtin files, if any"
    fi
    ;;
  install)
    command -v pi >/dev/null 2>&1 || {
      echo "pi is required but was not found on PATH" >&2
      echo "install Pi first: https://pi.dev" >&2
      exit 1
    }
    if ! pi_version_ok; then
      echo "Pi $MIN_PI or newer is required (found: $(pi --version 2>/dev/null || echo unknown))" >&2
      echo "upgrade with:  pi update --self" >&2
      exit 1
    fi
    command -v jj >/dev/null 2>&1 || echo "warning: jj not found on PATH; deccy rounds need it" >&2
    command -v deccy >/dev/null 2>&1 || echo "warning: deccy not found on PATH; graph writes need it" >&2
    command -v python3 >/dev/null 2>&1 || echo "warning: python3 not found; the subagents.json merge is skipped" >&2

    mkdir -p "$AGENT_ROOT" "$PI_LIST_DIR"
    check_conflicts

    if [ "$WITH_PACKAGES" -eq 1 ]; then
      install_pkg "$PKG_SUBAGENTS" "$PKG_SUBAGENTS_BASE"
      install_pkg "$PKG_PERMISSIONS" "$PKG_PERMISSIONS_BASE"
      if [ "$WITH_ASK" -eq 1 ]; then
        install_pkg "$PKG_ASK" "$PKG_ASK_BASE"
      fi
    fi

    if command -v python3 >/dev/null 2>&1; then
      merge_subagents_json "$SUBAGENTS_JSON"
    fi

    mkdir -p "$DEST_SKILLS" "$DEST_AGENTS" "$DEST_EXTENSIONS" "$DEST_BIN"
    link_all

    if [ -z "$PROJECT_DIR" ]; then
      for name in $SAFETY_AGENTS; do
        write_safety_agent "$name"
      done
    fi

    case ":$PATH:" in
      *":$DEST_BIN:"*) ;;
      *) echo "warning: $DEST_BIN is not on PATH; run $DEST_BIN/deccy-pi by absolute path" >&2;;
    esac

    echo
    if [ -n "$PROJECT_DIR" ]; then
      echo "project install: Pi runs from $PROJECT_DIR and trusts this project's .pi/ files."
      echo "add .pi/ to .gitignore so jj does not snapshot the links."
    else
      echo "global install: deccy-pi runs Pi from $AGENT_ROOT (neutral cwd)."
    fi
    echo "plain 'pi' sessions are unguarded; start a role with:  deccy-pi plan|orchestrator"
    echo "restart any running Pi sessions to pick up the links and packages."
    ;;
esac
