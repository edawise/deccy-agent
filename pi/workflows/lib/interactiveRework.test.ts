// interactiveRework tests — streamThinking (persistent thinking output for
// non-interactive runs) over a fake session bus: zero model calls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import { defaultOpenInEditor, runInteractiveReworkLoop, streamThinking } from "./interactiveRework.ts";
import { makePathCompleter } from "./pathComplete.ts";
import type { CommandSpec } from "./commandMenu.ts";

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

// ── "/" command menu ───────────────────────────────────────────────────

const SPECS: CommandSpec[] = [
  { name: "/ask", arg: "<question>", desc: ["Read-only Q&A."] },
  { name: "/plan", arg: "<task>", desc: ["Plan without applying."] },
  { name: "/check", desc: ["Run the validators."] },
];

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

test("typing / first opens the menu; Enter accepts the command into the line, colored", async () => {
  const saved = {
    NO_COLOR: process.env.NO_COLOR,
    FORCE_COLOR: process.env.FORCE_COLOR,
    TERM: process.env.TERM,
  };
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  process.env.TERM = "xterm-256color";
  try {
    const input = fakeTty();
    const cap = capture();
    (cap.out as any).isTTY = true; // CLI rendering: the accepted command gets color
    const commands: string[] = [];
    const turns: string[] = [];
    const done = runInteractiveReworkLoop({
      promptLabel: "> ",
      commands: SPECS,
      inputStream: input,
      outputStream: cap.out,
      onTurn: async (t) => {
        turns.push(t);
      },
      onCommand: (cmd, arg) => {
        commands.push(`${cmd}:${arg}`);
      },
    });
    input.write("/"); // the very first character: the menu pops up
    await until(() => cap.text().includes("[Up/Down select") && cap.text().includes("/plan"), "the menu");
    input.write("\r"); // Enter accepts — it never submits
    await until(() => cap.text().includes("\x1b[1m\x1b[36m/ask"), "the accepted command in color");
    assert.deepEqual(turns, []);
    assert.deepEqual(commands, []);
    input.write("why\n"); // the argument typed after acceptance runs the command
    await until(() => commands.length === 1, "the accepted command turn");
    assert.deepEqual(commands, ["/ask:why"]);
    assert.deepEqual(turns, []);
    input.write("/exit\n");
    await done;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("the menu narrows as more characters are typed; Esc closes and keeps the text", async () => {
  const input = fakeTty();
  const cap = capture();
  const commands: string[] = [];
  const done = runInteractiveReworkLoop({
    promptLabel: "> ",
    commands: SPECS,
    inputStream: input,
    outputStream: cap.out,
    onTurn: async () => {},
    onCommand: (cmd, arg) => {
      commands.push(`${cmd}:${arg}`);
    },
  });
  input.write("/");
  await until(() => count(cap.text(), "[Up/Down select") === 1, "the first menu render");
  input.write("a"); // narrows to /ask only
  await until(() => count(cap.text(), "[Up/Down select") === 2, "the narrowed render");
  assert.equal(count(cap.text(), "/plan"), 1); // listed only while unfiltered
  assert.ok(count(cap.text(), "/ask") >= 2);
  input.write("\x1b"); // Esc closes the menu...
  input.write("\n"); // ...and the typed text is kept and submitted
  await until(() => commands.length === 1, "the kept text");
  assert.deepEqual(commands, ["/a:"]);
  input.write("/exit\n");
  await done;
});

test("Down moves the selection and Enter accepts the highlighted command", async () => {
  const input = fakeTty();
  const cap = capture();
  const commands: string[] = [];
  const done = runInteractiveReworkLoop({
    promptLabel: "> ",
    commands: SPECS,
    inputStream: input,
    outputStream: cap.out,
    onTurn: async () => {},
    onCommand: (cmd, arg) => {
      commands.push(`${cmd}:${arg}`);
    },
  });
  input.write("/");
  await until(() => count(cap.text(), "[Up/Down select") === 1, "the menu");
  input.write("\x1b[B"); // Down: /ask -> /plan
  await until(() => count(cap.text(), "[Up/Down select") === 2, "the moved selection");
  input.write("\r"); // accepts /plan (without Down it would have been /ask)
  input.write("now\n");
  await until(() => commands.length === 1, "the accepted command");
  assert.deepEqual(commands, ["/plan:now"]);
  input.write("/exit\n");
  await done;
});

test("Up wraps to the last item and a no-arg command accepts bare", async () => {
  const input = fakeTty();
  const cap = capture();
  const commands: string[] = [];
  const done = runInteractiveReworkLoop({
    promptLabel: "> ",
    commands: SPECS,
    inputStream: input,
    outputStream: cap.out,
    onTurn: async () => {},
    onCommand: (cmd, arg) => {
      commands.push(`${cmd}:${arg}`);
    },
  });
  input.write("/");
  await until(() => count(cap.text(), "[Up/Down select") === 1, "the menu");
  input.write("\x1b[A"); // Up from the first item wraps to the last (/check)
  await until(() => count(cap.text(), "[Up/Down select") === 2, "the moved selection");
  input.write("\r"); // accepts /check (no arg: no trailing space)
  input.write("\n"); // and one Enter runs it
  await until(() => commands.length === 1, "the accepted command");
  assert.deepEqual(commands, ["/check:"]);
  input.write("/exit\n");
  await done;
});

test("with no matching command, Enter submits the line as-is", async () => {
  const input = fakeTty();
  const cap = capture();
  const commands: string[] = [];
  const done = runInteractiveReworkLoop({
    promptLabel: "> ",
    commands: SPECS,
    inputStream: input,
    outputStream: cap.out,
    onTurn: async () => {},
    onCommand: (cmd, arg) => {
      commands.push(`${cmd}:${arg}`);
    },
  });
  input.write("/zz");
  await until(() => cap.text().includes("no matching command"), "the empty menu");
  input.write("\r"); // Enter is not claimed: the line runs
  await until(() => commands.length === 1, "the unknown command");
  assert.deepEqual(commands, ["/zz:"]);
  input.write("/exit\n");
  await done;
});

test("the menu never opens mid-line or from a paste", async () => {
  const input = fakeTty();
  const cap = capture();
  const turns: string[] = [];
  const commands: string[] = [];
  const done = runInteractiveReworkLoop({
    promptLabel: "> ",
    commands: SPECS,
    inputStream: input,
    outputStream: cap.out,
    onTurn: async (t) => {
      turns.push(t);
    },
    onCommand: (cmd, arg) => {
      commands.push(`${cmd}:${arg}`);
    },
  });
  input.write("x/"); // "/" is not the first character
  input.write("\n");
  await until(() => turns.length === 1, "the plain turn");
  assert.deepEqual(turns, ["x/"]);
  input.write("\x1b[200~/check\x1b[201~"); // a pasted command is not typing
  input.write("\n");
  await until(() => commands.length === 1, "the pasted command");
  assert.deepEqual(commands, ["/check:"]);
  assert.equal(count(cap.text(), "[Up/Down select"), 0); // never shown
  input.write("/exit\n");
  await done;
});

test("the menu does not open while the editor is composing", async () => {
  const input = fakeTty();
  const cap = capture();
  const turns: string[] = [];
  const done = runInteractiveReworkLoop({
    promptLabel: "> ",
    commands: SPECS,
    inputStream: input,
    outputStream: cap.out,
    onTurn: async (t) => {
      turns.push(t);
    },
    onCommand: () => {},
    openEditor: async () => {
      input.write("/"); // typed while "the editor" owns the terminal
      (input as any).resume(); // the editor reads (and drops) it
      await new Promise((r) => setTimeout(r, 10));
      (input as any).pause();
      return "";
    },
  });
  input.write("\x07"); // Ctrl-G
  await until(() => cap.text().includes("[editor cancelled]"), "the cancelled editor");
  assert.equal(count(cap.text(), "[Up/Down select"), 0);
  input.write("hi\n"); // the dropped keystroke never leaked into the line
  await until(() => turns.length === 1, "the next turn");
  assert.deepEqual(turns, ["hi"]);
  input.write("/exit\n");
  await done;
});

test("defaultOpenInEditor runs $EDITOR and returns the file content", async () => {
  const out = await defaultOpenInEditor("seed text", { EDITOR: "true" });
  assert.equal(out, "seed text");
  await assert.rejects(() => defaultOpenInEditor("x", { EDITOR: "false" }), /exited with code/);
});

// ── Tab completion ────────────────────────────────────────────────────────

test("Tab completes a file path in the prompt line", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "deccy-tab-test-"));
  writeFileSync(path.join(root, "README.md"), "# hi\n");
  const input = fakeTty();
  const cap = capture();
  const turns: string[] = [];
  const done = runInteractiveReworkLoop({
    promptLabel: "> ",
    completer: makePathCompleter(root),
    inputStream: input,
    outputStream: cap.out,
    onTurn: async (t) => {
      turns.push(t);
    },
  });
  input.write("REA");
  input.write("\t"); // unique match: the word completes in place
  await until(() => cap.text().includes("README.md"), "the completed path");
  input.write("\n");
  await until(() => turns.length === 1, "the completed turn");
  assert.deepEqual(turns, ["README.md"]);
  input.write("/exit\n");
  await done;
});

test("Tab with several matches: a second Tab lists them and runs nothing", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "deccy-tab-test-"));
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "styles.css"), "x{}\n");
  const input = fakeTty();
  const cap = capture();
  const turns: string[] = [];
  const done = runInteractiveReworkLoop({
    promptLabel: "> ",
    completer: makePathCompleter(root),
    inputStream: input,
    outputStream: cap.out,
    onTurn: async (t) => {
      turns.push(t);
    },
  });
  input.write("s");
  input.write("\t"); // "s" is already the common prefix: nothing to insert
  await until(() => cap.text().includes("> s"), "the first Tab (no change)");
  input.write("\t"); // the second Tab lists the matches
  await until(() => cap.text().includes("styles.css") && cap.text().includes("src/"), "the match list");
  assert.deepEqual(turns, []); // listing never runs anything
  input.write("\x15"); // clear the line before leaving
  input.write("/exit\n");
  await done;
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
