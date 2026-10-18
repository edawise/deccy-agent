// interactiveRework tests — streamThinking (persistent thinking output for
// non-interactive runs) over a fake session bus: zero model calls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { runInteractiveReworkLoop, streamThinking } from "./interactiveRework.ts";

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
