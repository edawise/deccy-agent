// ttyStyle tests — styling is stream-gated (TTY only, standard opt-outs) and
// the reply border is identity when styling is off.

import { test } from "node:test";
import assert from "node:assert/strict";
import { styleFor, colorsEnabled } from "./ttyStyle.ts";

const tty = { isTTY: true };
const pipe = { isTTY: false };

/** Set env vars for the duration of a test; returns a restore function. */
function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(vars)) {
    saved.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

test("styles come out only on TTY streams", () => {
  const restore = setEnv({ NO_COLOR: undefined, FORCE_COLOR: undefined, TERM: "xterm-256color" });
  try {
    assert.equal(styleFor(pipe).green("x"), "x");
    assert.equal(styleFor(undefined).green("x"), "x");
    assert.equal(styleFor(tty).green("x"), "\x1b[32mx\x1b[0m");
    assert.equal(styleFor(tty).bold("x"), "\x1b[1mx\x1b[0m");
    assert.equal(colorsEnabled(tty), true);
    assert.equal(colorsEnabled(pipe), false);
  } finally {
    restore();
  }
});

test("NO_COLOR and TERM=dumb disable colors even on a TTY", () => {
  for (const env of [{ NO_COLOR: "1" }, { TERM: "dumb" }, { FORCE_COLOR: "0" }]) {
    const restore = setEnv({ NO_COLOR: undefined, FORCE_COLOR: undefined, TERM: "xterm-256color", ...env });
    try {
      assert.equal(styleFor(tty).red("x"), "x", `env ${JSON.stringify(env)}`);
    } finally {
      restore();
    }
  }
});

test("FORCE_COLOR turns colors on for a pipe", () => {
  const restore = setEnv({ NO_COLOR: undefined, FORCE_COLOR: "1", TERM: "xterm-256color" });
  try {
    assert.equal(styleFor(pipe).cyan("x"), "\x1b[36mx\x1b[0m");
  } finally {
    restore();
  }
});

test("FORCE_COLOR=1 wins over NO_COLOR", () => {
  const restore = setEnv({ NO_COLOR: "1", FORCE_COLOR: "1", TERM: "xterm-256color" });
  try {
    assert.equal(styleFor(tty).green("x"), "\x1b[32mx\x1b[0m");
  } finally {
    restore();
  }
});

test("border prefixes every line with a dim gutter; blank lines get a bare gutter", () => {
  const restore = setEnv({ NO_COLOR: undefined, FORCE_COLOR: undefined, TERM: "xterm-256color" });
  try {
    const s = styleFor(tty);
    assert.equal(s.border("a\n\nb"), "\x1b[36m│\x1b[0m a\n\x1b[36m│\x1b[0m\n\x1b[36m│\x1b[0m b");
    assert.equal(s.magenta("x"), "\x1b[35mx\x1b[0m");
  } finally {
    restore();
  }
});

test("border is identity when styling is off", () => {
  const restore = setEnv({ NO_COLOR: undefined, FORCE_COLOR: undefined, TERM: "xterm-256color" });
  try {
    assert.equal(styleFor(pipe).border("a\nb"), "a\nb");
  } finally {
    restore();
  }
});
