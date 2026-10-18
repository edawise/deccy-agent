// mdTerm tests — Markdown subset renders to styled terminal text on styled
// streams and stays byte-identical raw Markdown when styling is off.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Styler } from "./ttyStyle.ts";
import { renderMarkdown } from "./mdTerm.ts";

/** Tag-based fake styler: assertions stay readable and env-independent. */
const styled: Styler = {
  enabled: true,
  bold: (t) => `<b>${t}</b>`,
  dim: (t) => `<d>${t}</d>`,
  italic: (t) => `<i>${t}</i>`,
  red: (t) => `<r>${t}</r>`,
  green: (t) => `<g>${t}</g>`,
  yellow: (t) => `<y>${t}</y>`,
  cyan: (t) => `<c>${t}</c>`,
  magenta: (t) => `<m>${t}</m>`,
  gray: (t) => `<a>${t}</a>`,
  border: (t) => t,
};

const plain: Styler = {
  ...styled,
  enabled: false,
  bold: (t) => t,
  dim: (t) => t,
  italic: (t) => t,
  red: (t) => t,
  green: (t) => t,
  yellow: (t) => t,
  cyan: (t) => t,
  magenta: (t) => t,
  gray: (t) => t,
};

test("raw Markdown passes through untouched when styling is off", () => {
  const src = "# Head\n\nSome **bold** and `code` here.\n\n- item one\n";
  assert.equal(renderMarkdown(src, plain), src);
});

test("headings, bold, italic, and inline code render per-element", () => {
  const src = "# Head\n\nSome **bold**, *soft*, and `code` here.";
  assert.equal(
    renderMarkdown(src, styled),
    "<b><c>Head</c></b>\n\nSome <b>bold</b>, <i>soft</i>, and <y>code</y> here.",
  );
});

test("fenced code blocks render yellow and lose their fence markers", () => {
  const src = "```sh\nrun me\n```\nafter";
  assert.equal(renderMarkdown(src, styled), "<y>run me</y>\nafter");
});

test("lists get cyan bullets/numbers, quotes dim, links cyan with dim url", () => {
  const src = "- alpha\n2. beta\n> quoted\nSee [docs](https://x.y) now.";
  assert.equal(
    renderMarkdown(src, styled),
    "<c>•</c> alpha\n<c>2.</c> beta\n<d>quoted</d>\nSee <c>docs</c> <d>(https://x.y)</d> now.",
  );
});

test("snake_case identifiers are not italicized", () => {
  const src = "use foo_bar_baz and my_var_name here";
  assert.equal(renderMarkdown(src, styled), src);
});
