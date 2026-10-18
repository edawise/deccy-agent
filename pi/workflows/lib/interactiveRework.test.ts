// interactiveRework tests — streamThinking (persistent thinking output for
// non-interactive runs) over a fake session bus: zero model calls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import { defaultOpenInEditor, runInteractiveReworkLoop, streamThinking } from "./interactiveRework.ts";

/** Fake session: lets tests emit raw SDK-shaped events. */
function fakeSession() {
  const listeners: ((event: any) => void)[] = [];
  return {
    subscribe(listener: (event: any) => void) {
      listeners.push(listener);
      return () => {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    emit(assistantMessageEvent: any) {
      for (const l of [...listeners]) l({ type: "message_update", assistantMessageEvent });
    },
  };
}

function capture(): { out: Writable; text: () => string } {
  const chunks: string[] = [];
  return {
    out: new Writable({
      write(chunk, _enc, cb) {
        chunks.push(String(chunk));
        cb();
      },
    }),
    text: () => chunks.join(""),
  };
}

test("streamThinking prints a thinking block as it streams", () => {
  const session = fakeSession();
  const { out, text } = capture();
  const stop = streamThinking(session, out);
  session.emit({ type: "thinking_start" });
  session.emit({ type: "thinking_delta", delta: "let me look at " });
  session.emit({ type: "thinking_delta", delta: "the nodes" });
  session.emit({ type: "thinking_end" });
  stop();
  assert.equal(text(), "[thinking]\nlet me look at the nodes\n");
});

test("runInteractiveReworkLoop: TTY replies get the gutter, pipes stay plain", async () => {
  const saved = {
    NO_COLOR: process.env.NO_COLOR,
    FORCE_COLOR: process.env.FORCE_COLOR,
    TERM: process.env.TERM,
  };
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  process.env.TERM = "xterm-256color";
  try {
    const ttyCap = capture();
    (ttyCap.out as any).isTTY = true;
    await runInteractiveReworkLoop({
      promptLabel: "> ",
      inputStream: Readable.from(["hello\n", "/exit\n"]),
      outputStream: ttyCap.out,
      onTurn: async () => "line one\nline two",
    });
    const stripAnsi = (t: string) => t.replace(/\x1b\[[0-9;]*m/g, "");
    assert.match(stripAnsi(ttyCap.text()), /│ line one\n│ line two/);

    const pipeCap = capture();
    await runInteractiveReworkLoop({
      promptLabel: "> ",
      inputStream: Readable.from(["hello\n", "/exit\n"]),
      outputStream: pipeCap.out,
      onTurn: async () => "line one\nline two",
    });
    assert.match(pipeCap.text(), /\nline one\nline two\n/);
    assert.equal(pipeCap.text().includes("│"), false);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("streamThinking handles deltas without a start and stops on unsubscribe", () => {
  const session = fakeSession();
  const { out, text } = capture();
  const stop = streamThinking(session, out);
  session.emit({ type: "thinking_delta", delta: "hmm" });
  session.emit({ type: "thinking_end" });
  stop();
  session.emit({ type: "thinking_delta", delta: "ignored" });
  assert.equal(text(), "[thinking]\nhmm\n");
});

test("streamThinking is a no-op without a subscribable session", () => {
  const { out, text } = capture();
  streamThinking(undefined, out);
  streamThinking({}, out);
  assert.equal(text(), "");
});

// ── Paste + Ctrl-G input handling ────────────────────────────────────────

/** Fake TTY input: keypress handling (terminal mode) without a real terminal. */
function fakeTty(): PassThrough {
  const input = new PassThrough();
  (input as any).isTTY = true;
  (input as any).setRawMode = () => {};
  return input;
}

async function until(cond: () => boolean, what = "condition"): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(cond(), `timed out waiting for ${what}`);
}

test("a multi-line paste is echoed, staged, and runs on Enter", async () => {
  const turns: string[] = [];
  const commands: string[] = [];
  const cap = capture();
  await runInteractiveReworkLoop({
    promptLabel: "> ",
    inputStream: Readable.from(["\x1b[200~/ask what tools\nand where?\x1b[201~", "\n", "/exit\n"]),
    outputStream: cap.out,
    onTurn: async (t) => {
      turns.push(t);
    },
    onCommand: (cmd, arg) => {
      commands.push(`${cmd}:${arg}`);
    },
  });
  assert.deepEqual(turns, []);
  assert.deepEqual(commands, ["/ask:what tools\nand where?"]);
  // the pasted text is visible ("view what i pasted") and the hint explains Enter
  assert.match(cap.text(), /\/ask what tools\nand where\?/);
  assert.match(cap.text(), /pasted 2 lines — Enter runs it/);
});

test("a paste does not run by itself — typing afterwards appends a line", async () => {
  const turns: string[] = [];
  await runInteractiveReworkLoop({
    promptLabel: "> ",
    inputStream: Readable.from(["\x1b[200~line one\nline two\x1b[201~", "line three\n", "/exit\n"]),
    outputStream: capture().out,
    onTurn: async (t) => {
      turns.push(t);
    },
  });
  assert.deepEqual(turns, ["line one\nline two\nline three"]);
});

test("a single-line paste lands in the prompt line and runs on Enter", async () => {
  const input = fakeTty();
  const turns: string[] = [];
  const done = runInteractiveReworkLoop({
    promptLabel: "> ",
    inputStream: input,
    outputStream: capture().out,
    onTurn: async (t) => {
      turns.push(t);
    },
  });
  input.write("\x1b[200~condense the nodes\n\x1b[201~"); // trailing \n does NOT run it
  input.write(" today\n");
  await until(() => turns.length === 1, "the composed turn");
  assert.deepEqual(turns, ["condense the nodes today"]);
  input.write("/exit\n");
  await done;
});

test("a bare single-line paste composes into the prompt line and submits on Enter", async () => {
  const input = fakeTty();
  const turns: string[] = [];
  const done = runInteractiveReworkLoop({
    promptLabel: "> ",
    inputStream: input,
    outputStream: capture().out,
    onTurn: async (t) => {
      turns.push(t);
    },
  });
  input.write("\x1b[200~pasted frag\x1b[201~");
  input.write(" plus typed\n");
  await until(() => turns.length === 1, "the composed turn");
  assert.deepEqual(turns, ["pasted frag plus typed"]);
  input.write("/exit\n");
  await done;
});

test("Ctrl-G opens the editor and stages its result — Enter runs it", async () => {
  const input = fakeTty();
  const turns: string[] = [];
  const opened: string[] = [];
  const cap = capture();
  const done = runInteractiveReworkLoop({
    promptLabel: "> ",
    inputStream: input,
    outputStream: cap.out,
    onTurn: async (t) => {
      turns.push(t);
    },
    openEditor: async (initial) => {
      opened.push(initial);
      return "editor line1\neditor line2";
    },
  });
  input.write("typed so far");
  input.write("\x07"); // Ctrl-G
  await until(() => opened.length === 1, "the editor call");
  await until(() => cap.text().includes("[editor buffer staged — Enter runs it]"), "the staged hint");
  assert.deepEqual(opened, ["typed so far"]);
  assert.deepEqual(turns, []); // nothing runs without Enter
  input.write("\n");
  await until(() => turns.length === 1, "the editor turn");
  assert.deepEqual(turns, ["editor line1\neditor line2"]);
  // the editor is announced and what is staged is echoed
  assert.match(cap.text(), /write your prompt, then save\+exit — it gets staged and Enter runs it/);
  assert.match(cap.text(), /editor line1\neditor line2/);
  input.write("/exit\n");
  await done;
});

test("Ctrl-G with an empty editor result cancels and keeps the session", async () => {
  const input = fakeTty();
  const turns: string[] = [];
  const cap = capture();
  let opened = 0;
  const done = runInteractiveReworkLoop({
    promptLabel: "> ",
    inputStream: input,
    outputStream: cap.out,
    onTurn: async (t) => {
      turns.push(t);
    },
    openEditor: async () => {
      opened++;
      return "";
    },
  });
  input.write("\x07");
  await until(() => opened === 1, "the editor call");
  await until(() => cap.text().includes("[editor cancelled]"), "the cancel note");
  input.write("next\n");
  await until(() => turns.length === 1, "the next turn");
  assert.deepEqual(turns, ["next"]);
  input.write("/exit\n");
  await done;
});

test("Ctrl-G opens with staged paste text so it can be edited as one buffer", async () => {
  const input = fakeTty();
  const opened: string[] = [];
  const turns: string[] = [];
  const cap = capture();
  const done = runInteractiveReworkLoop({
    promptLabel: "> ",
    inputStream: input,
    outputStream: cap.out,
    onTurn: async (t) => {
      turns.push(t);
    },
    openEditor: async (initial) => {
      opened.push(initial);
      return `${initial} (edited)`;
    },
  });
  input.write("\x1b[200~staged line1\nstaged line2\x1b[201~");
  input.write("\x07"); // Ctrl-G right after the staged paste
  await until(() => opened.length === 1, "the editor call");
  await until(() => cap.text().includes("[editor buffer staged"), "the staged hint");
  assert.deepEqual(opened, ["staged line1\nstaged line2"]);
  input.write("\n");
  await until(() => turns.length === 1, "the staged editor turn");
  assert.deepEqual(turns, ["staged line1\nstaged line2 (edited)"]);
  input.write("/exit\n");
  await done;
});

test("defaultOpenInEditor runs $EDITOR and returns the file content", async () => {
  const out = await defaultOpenInEditor("seed text", { EDITOR: "true" });
  assert.equal(out, "seed text");
  await assert.rejects(() => defaultOpenInEditor("x", { EDITOR: "false" }), /exited with code/);
});

test("defaultOpenInEditor passes the temp file path to the editor", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "deccy-editor-test-"));
  const log = path.join(dir, "args.log");
  const fake = path.join(dir, "fake-editor.sh");
  // A fake editor that records its arguments and leaves the file untouched.
  writeFileSync(fake, `#!/bin/sh\necho "$@" > "${log}"\n`, { mode: 0o755 });
  const out = await defaultOpenInEditor("seed text", { EDITOR: fake });
  assert.equal(out, "seed text"); // file untouched
  const args = readFileSync(log, "utf8").trim();
  assert.match(args, /deccy-prompt-.*\.md$/); // the prompt file WAS handed to the editor
});
