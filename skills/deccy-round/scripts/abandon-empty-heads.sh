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
#     byte-identical restore of content owned by an existing node (its document or a
#     path its content.ref lists), or --force-superseded verifies every changed path
#     is a node document of an existing node and the head itself is conflicted.
# It abandons the remaining heads, then requires exactly one head (the working copy)
# and exits nonzero if any other head remains.
#
# Usage: abandon-empty-heads.sh [--dry-run] [--force-stray] [--force-superseded]
# Run inside the repository's working copy.
#
# --force-stray is for the orchestrator's post-landing cleanup: a draft, command or
# judge workspace may leave a head whose diff is a restored gate path such as
# nodes/<eval>.json, or a node document whose refs were landed with it. The script
# verifies that every changed path is the document of an existing node, or a path
# that node's content.ref lists, and that the head's content is identical to that
# node's; anything else is refused. A path outside nodes/ needs jq to resolve its
# owner; without jq the head is kept.
#
# --force-superseded is narrower and stricter in what it accepts: every changed path
# must be nodes/<owner>.json for an existing node, and the head must be conflicted
# (jj's own conflict state). A conflicted tree cannot be recorded, so it is never
# landable content; this is the head a judge workspace leaves when it restores a
# candidate that later went stale. A clean non-identical node copy is still refused.
# Direct `jj abandon` remains forbidden.

set -eu

DRY_RUN=0
FORCE_STRAY=0
FORCE_SUPERSEDED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --force-stray) FORCE_STRAY=1 ;;
    --force-superseded) FORCE_SUPERSEDED=1 ;;
    *)
      echo "usage: $0 [--dry-run] [--force-stray] [--force-superseded]" >&2
      exit 2
      ;;
  esac
  shift
done

# A force-stray head may only be a pure restore of content owned by an existing
# node: every changed path is nodes/<owner>.json, or a path listed in that node's
# content.ref array, and is byte-identical to the content at <owner>. Anything else
# is real draft content and is kept. Ref paths need jq to resolve their owner;
# without jq they are refused.
owner_of_ref() {
  path=$1
  command -v jq >/dev/null 2>&1 || return 1
  for doc in nodes/*.json; do
    [ -f "$doc" ] || continue
    if jq -e --arg p "$path" \
         '(.content.ref | type) == "array" and (.content.ref | index($p) != null)' \
         "$doc" >/dev/null 2>&1; then
      owner=${doc#nodes/}
      printf '%s' "${owner%.json}"
      return 0
    fi
  done
  return 1
}

is_owned_restore() {
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
      "A "*|"M "*) ;;
      *)
        IFS=$old_ifs
        return 1
        ;;
    esac
    path=${line#? }
    owner=""
    case "$path" in
      nodes/*".json")
        owner=${path#nodes/}
        owner=${owner%.json}
        ;;
      *)
        owner=$(owner_of_ref "$path") || { IFS=$old_ifs; return 1; }
        ;;
    esac
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

# A force-superseded head must be a conflicted copy of existing node documents:
# every changed path is nodes/<owner>.json for an existing node, and jj reports the
# head itself as conflicted, so it can never be recorded. A clean non-identical copy
# of a node document is real content and is refused.
is_conflicted_node_copy() {
  id=$1
  [ "$(jj log -r "$id" --no-graph -T 'conflict' 2>/dev/null)" = "true" ] || return 1
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
    jj file show -r "$owner" "nodes/$owner.json" >/dev/null 2>&1 || {
      IFS=$old_ifs
      return 1
    }
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
    if [ "$FORCE_STRAY" -eq 1 ] && is_owned_restore "$id"; then
      verified_stray=1
    elif [ "$FORCE_SUPERSEDED" -eq 1 ] && is_conflicted_node_copy "$id"; then
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
