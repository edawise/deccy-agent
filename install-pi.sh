#!/bin/sh
# Install the deccy-agent pi workflows + skills from GitHub.
#
# Installs the pi/ tree (workflows + skills + npm dependency) to a stable
# location, symlinks the skills into pi's discovery path, and drops
# `deccy-plan` / `deccy-exec` / `deccy-edit` wrapper commands on your PATH.
#
# Usage:
#   ./install-pi.sh                        # global install (default)
#   ./install-pi.sh --project <dir>        # project-local skills into <dir>/.pi/skills
#   ./install-pi.sh --ref <branch|tag|sha> # install a specific ref (default: main)
#   ./install-pi.sh --uninstall            # remove installed files (with --project for local)
#
# Env overrides:
#   REPO_URL     GitHub repo (default: https://github.com/edawise/deccy-agent)
#   DEST_APP     install dir (default: ~/.pi/agent/deccy-agent)
#   DEST_SKILLS  pi skill discovery dir (default: ~/.pi/agent/skills)
#   DEST_BIN     wrapper dir (default: ~/.local/bin)
set -eu

REPO_URL="${REPO_URL:-https://github.com/edawise/deccy-agent}"
REF="main"
PROJECT_DIR=""
UNINSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT_DIR="${2:?--project needs a directory}"; shift 2;;
    --ref) REF="${2:?--ref needs a branch, tag or sha}"; shift 2;;
    --uninstall) UNINSTALL=1; shift;;
    -h|--help) sed -n '2,17p' "$0"; exit 0;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 1;;
  esac
done

APP_DIR="${DEST_APP:-$HOME/.pi/agent/deccy-agent}"
BIN_DIR="${DEST_BIN:-$HOME/.local/bin}"
if [ -n "$PROJECT_DIR" ]; then
  SKILLS_DIR="$PROJECT_DIR/.pi/skills"
else
  SKILLS_DIR="${DEST_SKILLS:-$HOME/.pi/agent/skills}"
fi

SKILL_LINK_1="$SKILLS_DIR/deccy-agent"
SKILL_LINK_2="$SKILLS_DIR/deccy-plan"
WRAP_PLAN="$BIN_DIR/deccy-plan"
WRAP_EXEC="$BIN_DIR/deccy-exec"
WRAP_EDIT="$BIN_DIR/deccy-edit"

if [ "$UNINSTALL" -eq 1 ]; then
  rm -f "$SKILL_LINK_1" "$SKILL_LINK_2" "$WRAP_PLAN" "$WRAP_EXEC" "$WRAP_EDIT"
  [ -n "$PROJECT_DIR" ] || rm -rf "$APP_DIR"
  echo "removed skill links and wrappers$( [ -n "$PROJECT_DIR" ] || echo " and $APP_DIR" )"
  exit 0
fi

command -v node >/dev/null 2>&1 || { echo "node is required (Node >= 22)" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }
node_major="$(node -v | sed 's/^v//; s/\..*//')"
[ "$node_major" -ge 22 ] || { echo "Node >= 22 required (found $(node -v))" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone --quiet --depth 1 --branch "$REF" "$REPO_URL" "$TMP/repo" 2>/dev/null \
  || { git clone --quiet "$REPO_URL" "$TMP/repo" && git -C "$TMP/repo" checkout --quiet "$REF"; }

# 1. The pi tree (workflows + skills) into the app dir; node_modules is rebuilt.
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
cp -r "$TMP/repo/pi/." "$APP_DIR"
rm -rf "$APP_DIR/node_modules"

echo "installing npm dependency (one-time)..."
( cd "$APP_DIR" && npm install --no-audit --no-fund --silent )

# 2. Skill discovery: pi follows symlinked skill dirs, so link (not copy) —
#    one source of truth, and plan-gate.ts keeps resolving workflows/lib.
mkdir -p "$SKILLS_DIR"
ln -sfn "$APP_DIR/skills/deccy-agent" "$SKILL_LINK_1"
ln -sfn "$APP_DIR/skills/deccy-plan" "$SKILL_LINK_2"

# 3. Wrapper commands runnable from any directory.
mkdir -p "$BIN_DIR"
cat > "$WRAP_PLAN" <<EOF
#!/bin/sh
exec node "$APP_DIR/workflows/deccy-planner/index.ts" "\$@"
EOF
cat > "$WRAP_EXEC" <<EOF
#!/bin/sh
exec node "$APP_DIR/workflows/deccy-executor/index.ts" "\$@"
EOF
cat > "$WRAP_EDIT" <<EOF
#!/bin/sh
exec node "$APP_DIR/workflows/deccy-edit/index.ts" "\$@"
EOF
chmod +x "$WRAP_PLAN" "$WRAP_EXEC" "$WRAP_EDIT"

echo "installed workflows -> $APP_DIR"
echo "linked skills      -> $SKILL_LINK_1"
echo "                   -> $SKILL_LINK_2"
echo "installed commands -> $WRAP_PLAN"
echo "                   -> $WRAP_EXEC"
echo "                   -> $WRAP_EDIT"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "note: add $BIN_DIR to PATH to use the deccy-plan / deccy-exec / deccy-edit commands";;
esac
echo
echo "try:  deccy-plan --help"
echo "      deccy-plan \"<request>\" --graph /path/to/deccy-repo"
echo "      deccy-exec --plan .deccy_plan.md --graph /path/to/deccy-repo"
echo "      deccy-edit \"<request>\" --graph /path/to/deccy-repo"
