// pasteFilter tests — bracketed-paste swallow/re-emit over byte streams: zero
// model calls, no TTYs required.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { PasteFilter } from "./pasteFilter.ts";

async function run(chunks: (string | Buffer)[]): Promise<{ passed: string; pasted: string[] }> {
  const filter = new PasteFilter();
  const pasted: string[] = [];
  const parts: string[] = [];
  filter.on("paste", (t) => pasted.push(t));
  filter.on("data", (d) => parts.push(String(d)));
  const ended = new Promise<void>((resolve) => filter.on("end", resolve));
  for (const c of chunks) filter.write(c);
  filter.end();
  await ended;
  return { passed: parts.join(""), pasted };
}

test("bytes outside paste regions pass through untouched", async () => {
  const { passed, pasted } = await run(["hello \x1b[A world\n", "next\n"]);
  assert.equal(passed, "hello \x1b[A world\nnext\n");
  assert.deepEqual(pasted, []);
});

test("a bracketed paste is swallowed and re-emitted as one event, newlines intact", async () => {
  const { passed, pasted } = await run(["before\x1b[200~line1\nline2\nline3\x1b[201~after\n"]);
  assert.equal(passed, "beforeafter\n");
  assert.deepEqual(pasted, ["line1\nline2\nline3"]);
});

test("markers split across chunk boundaries are handled", async () => {
  const { passed, pasted } = await run(["x\x1b[20", "0~a\nb\x1b[20", "1~y"]);
  assert.equal(passed, "xy");
  assert.deepEqual(pasted, ["a\nb"]);
});

test("escape sequences that are not markers keep passing through", async () => {
  const { passed, pasted } = await run(["\x1b[A\x1b[1;5C\x1b"]);
  assert.equal(passed, "\x1b[A\x1b[1;5C\x1b");
  assert.deepEqual(pasted, []);
});

test("stream end mid-paste hands over what was captured", async () => {
  const { pasted } = await run(["\x1b[200~partial"]);
  assert.deepEqual(pasted, ["partial"]);
});

test("multi-byte characters split across chunks survive", async () => {
  const buf = Buffer.from("héllo ✓");
  const { passed } = await run([buf.subarray(0, 3), buf.subarray(3)]);
  assert.equal(passed, "héllo ✓");
});

test("the filter can sit in front of readline as a stream", async () => {
  const src = new PassThrough();
  const filter = new PasteFilter();
  const pasted: string[] = [];
  filter.on("paste", (t) => pasted.push(t));
  src.pipe(filter);
  src.write("\x1b[200~one\ntwo\x1b[201~");
  src.end();
  const chunks: string[] = [];
  for await (const c of filter) chunks.push(String(c));
  assert.equal(chunks.join(""), "");
  assert.deepEqual(pasted, ["one\ntwo"]);
});
