// pathComplete tests — word-level path completion against a fixture tree:
// zero model calls, real filesystem in a temp dir.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { completePathWord, makePathCompleter } from "./pathComplete.ts";

/** Fixture root:
 *   README.md  styles.css  notes/{a,b}.md  src/{foo,foobar}.ts
 *   node_modules/pkg/index.js  .gitignore  .hidden/x.md  linked -> notes
 */
function fixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "deccy-pathcomplete-"));
  for (const d of ["notes", "src", "node_modules/pkg", ".hidden"]) {
    mkdirSync(path.join(root, d), { recursive: true });
  }
  const touch = (p: string) => writeFileSync(path.join(root, p), p);
  touch("README.md");
  touch("styles.css");
  touch("notes/a.md");
  touch("notes/b.md");
  touch("src/foo.ts");
  touch("src/foobar.ts");
  touch("node_modules/pkg/index.js");
  touch(".gitignore");
  touch(".hidden/x.md");
  symlinkSync(path.join(root, "notes"), path.join(root, "linked"));
  return root;
}

test("a unique prefix completes to the file", () => {
  const root = fixture();
  assert.deepEqual(completePathWord("READ", root), ["README.md"]);
});

test("several matches list dirs first, then codepoint order", () => {
  const root = fixture();
  assert.deepEqual(completePathWord("s", root), ["src/", "styles.css"]);
});

test("an empty word lists the root entries, without dot-entries or node_modules", () => {
  const root = fixture();
  assert.deepEqual(completePathWord("", root), ["linked/", "notes/", "src/", "README.md", "styles.css"]);
});

test("a directory keeps its trailing slash and the next Tab descends", () => {
  const root = fixture();
  assert.deepEqual(completePathWord("src/", root), ["src/foo.ts", "src/foobar.ts"]);
  assert.deepEqual(completePathWord("src/fo", root), ["src/foo.ts", "src/foobar.ts"]);
  assert.deepEqual(completePathWord("notes/a", root), ["notes/a.md"]);
});

test("the typed path prefix is kept verbatim in the replacement", () => {
  const root = fixture();
  assert.deepEqual(completePathWord("./READ", root), ["./README.md"]);
  assert.deepEqual(completePathWord("./src/fo", root), ["./src/foo.ts", "./src/foobar.ts"]);
});

test("symlinked dirs complete like dirs (trailing slash)", () => {
  const root = fixture();
  assert.deepEqual(completePathWord("li", root), ["linked/"]);
  assert.deepEqual(completePathWord("linked/", root), ["linked/a.md", "linked/b.md"]);
});

test("unknown or non-dir prefixes complete to nothing", () => {
  const root = fixture();
  assert.deepEqual(completePathWord("nope/", root), []);
  assert.deepEqual(completePathWord("README.md/", root), []); // a file is not a dir
  assert.deepEqual(completePathWord("zzz", root), []);
});

test("node_modules and VCS dirs are never suggested", () => {
  const root = fixture();
  assert.deepEqual(completePathWord("node", root), []); // node_modules never surfaces
  assert.deepEqual(completePathWord(".gi", root), [".gitignore"]); // .git itself is excluded
});

test("dot-entries are suggested only when the word itself starts with a dot", () => {
  const root = fixture();
  assert.deepEqual(completePathWord(".g", root), [".gitignore"]);
  assert.deepEqual(completePathWord(".hidden/", root), [".hidden/x.md"]);
  assert.deepEqual(completePathWord("h", root), []); // .hidden is not implied
});

test("slash-leading words are command territory, not paths", () => {
  const root = fixture();
  assert.deepEqual(completePathWord("/st", root), []);
  assert.deepEqual(completePathWord("/", root), []);
});

test("makePathCompleter completes the trailing word and reports it as completeOn", () => {
  const root = fixture();
  const completer = makePathCompleter(root);
  assert.deepEqual(completer("src/fo"), [["src/foo.ts", "src/foobar.ts"], "src/fo"]);
  // The word is the trailing token of whatever is before the cursor.
  assert.deepEqual(completer("look at src/fo"), [["src/foo.ts", "src/foobar.ts"], "src/fo"]);
  assert.deepEqual(completer("look at "), [["linked/", "notes/", "src/", "README.md", "styles.css"], ""]);
  assert.deepEqual(completer("/pl"), [[], "/pl"]);
});
