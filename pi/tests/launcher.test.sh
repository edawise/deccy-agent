#!/bin/sh
# Deterministic tests for pi/deccy-pi.
#
# The fake `pi` records the arguments and the DECCY_ROLE_FILE the launcher
# passes. The PTY cases use `script` so the launcher sees a terminal stdin.
#
#   sh pi/tests/launcher.test.sh
set -u

HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd)
BUNDLE=$(CDPATH= cd -P -- "$HERE/../.." && pwd)
LAUNCHER="$BUNDLE/pi/deccy-pi"
T="${TMPDIR:-/tmp}/deccy-pi-launcher-test.$$"
rm -rf "$T"
mkdir -p "$T/bin" "$T/home" "$T/agent" "$T/root"
T=$(CDPATH= cd -P -- "$T" && pwd)
F="$T/fake-pi.log"

cat > "$T/bin/pi" <<'SH'
#!/bin/sh
{
  printf 'CALL\n'
  for a do printf 'ARG %s\n' "$a"; done
  printf 'ROLE %s\n' "${DECCY_ROLE:-}"
  printf 'ROLE_FILE %s\n' "${DECCY_ROLE_FILE:-}"
} >> "$FAKE_PI_LOG"
exit 0
SH
chmod +x "$T/bin/pi"

export PATH="$T/bin:$PATH"
export HOME="$T/home" PI_AGENT_DIR="$T/agent" PI_CODING_AGENT_DIR="$T/agent"
export DECCY_AGENT_ROOT="$T/root" FAKE_PI_LOG="$F"

trap 'rm -rf "$T"' EXIT HUP INT TERM

pass=0
fail=0
skip=0
ok() { pass=$((pass + 1)); printf 'ok %d - %s\n' "$pass" "$1"; }
no() {
  fail=$((fail + 1))
  printf 'not ok %d - %s\n' "$fail" "$1"
  [ -n "${2:-}" ] && printf '  %s\n' "$2"
}
sk() { skip=$((skip + 1)); printf 'skip - %s\n' "$1"; }

reset() { : > "$F"; }
called() { grep -q '^CALL$' "$F"; }
has_arg() { grep -qxF "ARG $1" "$F"; }
no_body() { ! grep -qF 'You plan **one deccy layer**' "$F"; }
role_file_ok() { grep -qxF "ROLE_FILE $BUNDLE/pi/agents/deccy-plan.md" "$F"; }

# Run the launcher in a real pseudo-terminal. `script` gives it a tty stdin.
pty_run() {
  reset
  {
    echo '#!/bin/sh'
    printf '"%s" plan' "$LAUNCHER"
    for a do printf ' "%s"' "$a"; done
    echo
    echo 'printf "EXIT=%s\n" "$?"'
  } > "$T/pty-run.sh"
  chmod +x "$T/pty-run.sh"
  case "$(uname -s)" in
    Darwin) script -q /dev/null "$T/pty-run.sh" > "$T/pty.out" 2>&1 ;;
    *) script -q -e -c "$T/pty-run.sh" /dev/null > "$T/pty.out" 2>&1 ;;
  esac
}

# --- interactive -------------------------------------------------------------
reset
"$LAUNCHER" plan > "$T/out" 2> "$T/err"
code=$?
if [ "$code" -eq 0 ] && called && role_file_ok && no_body; then
  ok "interactive start is idle, passes no role body and exports the role file"
else
  no "interactive start is idle, passes no role body and exports the role file" \
    "exit=$code; $(head -3 "$T/err")"
fi

reset
"$LAUNCHER" plan "hello" > "$T/out" 2> "$T/err"
code=$?
if [ "$code" -eq 0 ] && has_arg hello && no_body; then
  ok "an interactive request is the only message"
else
  no "an interactive request is the only message" "exit=$code; $(head -3 "$T/err")"
fi

# --- non-interactive with a prompt ------------------------------------------
reset
"$LAUNCHER" plan -p "hello" > "$T/out" 2> "$T/err"
code=$?
if [ "$code" -eq 0 ] && has_arg -p && has_arg hello && no_body; then
  ok "-p with a request passes the request and no role body"
else
  no "-p with a request passes the request and no role body" "exit=$code; $(head -3 "$T/err")"
fi

reset
"$LAUNCHER" plan --mode json "hello" > "$T/out" 2> "$T/err"
code=$?
if [ "$code" -eq 0 ] && has_arg --mode && has_arg json && has_arg hello && no_body; then
  ok "--mode json with a request is accepted"
else
  no "--mode json with a request is accepted" "exit=$code; $(head -3 "$T/err")"
fi

reset
"$LAUNCHER" plan -- "hello" > "$T/out" 2> "$T/err"
code=$?
if [ "$code" -eq 0 ] && has_arg -- && has_arg hello && no_body; then
  ok "-- ends options and a following request is accepted"
else
  no "-- ends options and a following request is accepted" "exit=$code; $(head -3 "$T/err")"
fi

reset
"$LAUNCHER" plan --model opencode-go/gemini-4-argon -p "hello" > "$T/out" 2> "$T/err"
code=$?
if [ "$code" -eq 0 ] && has_arg hello && has_arg -p && no_body; then
  ok "an option value is not mistaken for a prompt"
else
  no "an option value is not mistaken for a prompt" "exit=$code; $(head -3 "$T/err")"
fi

# --- non-interactive without a prompt ---------------------------------------
if command -v script >/dev/null 2>&1; then
  pty_run -p
  if grep -q 'EXIT=2' "$T/pty.out" && ! called; then
    ok "-p with a terminal stdin and no prompt exits 2 without starting Pi"
  else
    no "-p with a terminal stdin and no prompt exits 2 without starting Pi" \
      "$(tail -4 "$T/pty.out")"
  fi
  if grep -q 'non-interactive mode needs a prompt' "$T/pty.out"; then
    ok "the no-prompt error names the missing prompt"
  else
    no "the no-prompt error names the missing prompt" "$(tail -4 "$T/pty.out")"
  fi

  pty_run --mode json
  if grep -q 'EXIT=2' "$T/pty.out" && ! called; then
    ok "--mode json with no prompt exits 2 without starting Pi"
  else
    no "--mode json with no prompt exits 2 without starting Pi" "$(tail -4 "$T/pty.out")"
  fi
else
  sk "PTY tests (script not installed)"
fi

# --- non-interactive with piped stdin ---------------------------------------
reset
printf 'hello\n' | "$LAUNCHER" plan -p > "$T/out" 2> "$T/err"
code=$?
if [ "$code" -eq 0 ] && called && has_arg -p; then
  ok "piped stdin satisfies the non-interactive input requirement"
else
  no "piped stdin satisfies the non-interactive input requirement" "exit=$code; $(head -3 "$T/err")"
fi

# --- pass-through commands ---------------------------------------------------
reset
"$LAUNCHER" plan --help > "$T/out" 2> "$T/err"
code=$?
if [ "$code" -eq 0 ] && has_arg --help && no_body; then
  ok "--help is passed through without a prompt check"
else
  no "--help is passed through without a prompt check" "exit=$code; $(head -3 "$T/err")"
fi

printf '\n%d passed, %d failed, %d skipped\n' "$pass" "$fail" "$skip"
[ "$fail" -eq 0 ]
