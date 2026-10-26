#!/bin/sh
# Abandon stray heads left by forgotten jj workspaces.
#
# `jj workspace forget` does not reliably remove a forgotten workspace's working-copy
# commit: a draft forgotten while it still carried content can survive as an empty head.
# This script is the orchestrator's only abandon path. It refuses to touch:
#   - the current working copy (@);
#   - the working-copy commit of any open workspace;
#   - a bookmarked head;
#   - a described head;
#   - a head whose change id names its own node document (nodes/<id>.json);
#   - any non-empty head, unless --force-stray verifies every changed path is a
#     byte-identical restore of an existing node document (a gate path or similar
#     draft artifact, not new content).
# It abandons the remaining heads, then requires exactly one head (the working copy)
# and exits nonzero if any other head remains.
#
# Usage: abandon-empty-heads.sh [--dry-run] [--force-stray]
# Run inside the repository's working copy.
#
# --force-stray is for the orchestrator's post-landing cleanup: a refine or judge
# workspace may leave a head whose only diff is a restored gate path such as
# nodes/<eval>.json. The script verifies that each such path is an existing node
# document and that the head's content is identical to that node's content; anything
# else is refused. Direct `jj abandon` remains forbidden.

set -eu

DRY_RUN=0
FORCE_STRAY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --force-stray) FORCE_STRAY=1 ;;
    *)
      echo "usage: $0 [--dry-run] [--force-stray]" >&2
      exit 2
      ;;
  esac
  shift
done

# A force-stray head may only be a pure restore of existing node documents:
# every changed path must be nodes/<owner>.json and byte-identical to the
# content at <owner>. Anything else is real draft content and is kept.
is_pure_restore() {
  id=$1
  lines=$(jj diff --summary -r "$id" 2>/dev/null || true)
  [ -n "$lines" ] || return 1
  seen=0
  old_ifs=$IFS
  IFS='
'
  for line in $lines; do
    IFS=$old_ifs
    case "$line" in
      "A nodes/"*".json"|"M nodes/"*".json") ;;
      *)
        IFS=$old_ifs
        return 1
        ;;
    esac
    path=${line#? }
    owner=${path#nodes/}
    owner=${owner%.json}
    [ -n "$owner" ] || { IFS=$old_ifs; return 1; }
    if ! jj file show -r "$owner" "$path" >/dev/null 2>&1; then
      IFS=$old_ifs
      return 1
    fi
    if [ "$(jj file show -r "$id" "$path" 2>/dev/null | shasum -a 256)" != \
         "$(jj file show -r "$owner" "$path" 2>/dev/null | shasum -a 256)" ]; then
      IFS=$old_ifs
      return 1
    fi
    seen=1
    IFS='
'
  done
  IFS=$old_ifs
  [ "$seen" -eq 1 ]
}

at=$(jj log -r @ --no-graph -T 'change_id.shortest(8)' 2>/dev/null) || {
  echo "abandon-empty-heads: not inside a jj workspace" >&2
  exit 2
}

heads=$(jj log -r 'heads(all())' --no-graph -T 'change_id.shortest(8) ++ "\n"')
workspaces=$(jj workspace list -T 'target.change_id().shortest(8) ++ "\n"' | tr '\n' ' ')
candidates=""
kept=""

for id in $heads; do
  [ -n "$id" ] || continue
  [ "$id" = "$at" ] && continue
  case " $workspaces " in
    *" $id "*)
      kept="$kept $id(open-workspace)"
      continue
      ;;
  esac

  empty=$(jj log -r "$id" --no-graph -T 'empty')
  verified_stray=0
  if [ "$empty" != "true" ]; then
    if [ "$FORCE_STRAY" -eq 1 ] && is_pure_restore "$id"; then
      verified_stray=1
    else
      kept="$kept $id(non-empty)"
      continue
    fi
  fi

  description=$(jj log -r "$id" --no-graph -T 'description.first_line()')
  if [ -n "$description" ]; then
    kept="$kept $id(described)"
    continue
  fi

  bookmarks=$(jj log -r "$id" --no-graph -T 'bookmarks')
  if [ -n "$bookmarks" ]; then
    kept="$kept $id(bookmark:$bookmarks)"
    continue
  fi

  if jj file show -r "$id" "nodes/$id.json" >/dev/null 2>&1; then
    kept="$kept $id(node-change)"
    continue
  fi

  if [ "$verified_stray" -eq 0 ] && [ -n "$(jj diff --summary -r "$id")" ]; then
    kept="$kept $id(diff)"
    continue
  fi

  candidates="$candidates $id"
done

if [ -z "$candidates" ]; then
  echo "abandon-empty-heads: no empty stray heads"
else
  for id in $candidates; do
    echo "abandon-empty-heads: abandoning head $id"
    if [ "$DRY_RUN" -eq 0 ]; then
      jj abandon "$id"
    fi
  done
fi

[ -n "$kept" ] && echo "abandon-empty-heads: kept$kept"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "abandon-empty-heads: dry run; heads before cleanup:"
  printf '%s\n' "$heads"
  exit 0
fi

remaining=$(jj log -r 'heads(all())' --no-graph -T 'change_id.shortest(8) ++ "\n"' | sed '/^$/d')
count=$(printf '%s\n' "$remaining" | wc -l | tr -d ' ')
if [ "$count" -ne 1 ] || [ "$remaining" != "$at" ]; then
  echo "abandon-empty-heads: heads remain after cleanup:" >&2
  printf '%s\n' "$remaining" >&2
  exit 1
fi
echo "abandon-empty-heads: one head remains ($at)"
