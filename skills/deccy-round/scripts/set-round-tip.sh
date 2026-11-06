#!/bin/sh
# Move the working copy above the round's highest landed node change.
#
# A landed decision's gate is its child, so a landing's `jj new <target>` leaves
# the gate as a sibling head rather than above it. This script finds the node
# change (a change carrying nodes/<id>.json) that no other node change descends
# from, and starts a new empty change above it. It refuses a fork of two node
# changes and any repository without a node change.
#
# Usage: set-round-tip.sh [--dry-run]
set -eu

DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    *)
      echo "usage: $0 [--dry-run]" >&2
      exit 2
      ;;
  esac
  shift
done

nodes=""
for id in $(jj log -r 'all()' --no-graph -T 'change_id.shortest(8) ++ "\n"'); do
  if jj file show -r "$id" "nodes/$id.json" >/dev/null 2>&1; then
    nodes="$nodes $id"
  fi
done

top=""
for a in $nodes; do
  is_top=1
  for b in $nodes; do
    [ "$a" = "$b" ] && continue
    if [ -n "$(jj log -r "$a::$b" --no-graph -T 'change_id' 2>/dev/null)" ]; then
      is_top=0
      break
    fi
  done
  if [ "$is_top" -eq 1 ]; then
    if [ -n "$top" ]; then
      echo "set-round-tip: two node heads: $top $a" >&2
      exit 1
    fi
    top=$a
  fi
done

if [ -z "$top" ]; then
  echo "set-round-tip: no node change found" >&2
  exit 1
fi

if [ -n "$(jj log -r "$top::@" --no-graph -T 'change_id' 2>/dev/null)" ]; then
  echo "set-round-tip: working copy is already above $top"
  exit 0
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "set-round-tip: would start a new change above $top"
  exit 0
fi

jj new "$top"
echo "set-round-tip: started a new change above $top"
