// commandMenu tests — filtering, selection rows and prompt measuring for the
// "/" menu: zero model calls, pure functions.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commandToken,
  filterCommands,
  renderMenu,
  visibleWidth,
  type CommandSpec,
} from "./commandMenu.ts";
import { styleFor } from "./ttyStyle.ts";

const COMMANDS: CommandSpec[] = [
  { name: "/ask", arg: "<question>", desc: ["Read-only Q&A."] },
  { name: "/plan", arg: "<task>", desc: ["Plan without applying."] },
  { name: "/check", desc: ["Run the validators."] },
];

test("filterCommands narrows case-insensitively by prefix", () => {
  assert.deepEqual(filterCommands(COMMANDS, ""), COMMANDS);
  assert.deepEqual(filterCommands(COMMANDS, "a"), [COMMANDS[0]]);
  assert.deepEqual(filterCommands(COMMANDS, "AS"), [COMMANDS[0]]);
  assert.deepEqual(filterCommands(COMMANDS, "pl"), [COMMANDS[1]]);
  assert.deepEqual(filterCommands(COMMANDS, "z"), []);
});

test("commandToken finds only known commands at the start of the line", () => {
  assert.equal(commandToken("/ask why", COMMANDS), "/ask");
  assert.equal(commandToken("/ask", COMMANDS), "/ask");
  assert.equal(commandToken("/zz why", COMMANDS), null);
  assert.equal(commandToken("say /ask", COMMANDS), null);
  assert.equal(commandToken("", COMMANDS), null);
});

test("renderMenu marks the selection and adds a key hint", () => {
  const plain = styleFor(null); // identity styling
  const rows = renderMenu(COMMANDS, 1, plain);
  assert.equal(rows.length, COMMANDS.length + 1); // one per command + hint
  assert.equal(rows[0], "  /ask <question>  Read-only Q&A.");
  assert.equal(rows[1], "❯ /plan <task>  Plan without applying.");
  assert.equal(rows[2], "  /check  Run the validators.");
  assert.match(rows[3], /Enter accept/);
});

test("renderMenu with no matches degrades to one dim row", () => {
  const rows = renderMenu([], 0, styleFor(null));
  assert.deepEqual(rows, ["no matching command"]);
});

test("visibleWidth ignores ANSI styling", () => {
  assert.equal(visibleWidth("\x1b[1m\x1b[36m/ask\x1b[0m"), 4);
  assert.equal(visibleWidth("plain"), 5);
});
