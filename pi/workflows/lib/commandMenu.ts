// commandMenu — the "/" command menu for the workflow REPL: filtering,
// selection rows and prompt measuring. Pure logic + ANSI strings; the live
// region and key handling live in interactiveRework.ts.
//
// Behavior (see DECISIONS.md, "REPL input"): the menu opens only when "/" is
// typed as the very first character of an empty line, narrows as the user
// types, Up/Down move the selection, and Enter ACCEPTS the highlighted
// command into the prompt line — repainted in color — without submitting.

import type { Styler } from "./ttyStyle.ts";

export interface CommandSpec {
  /** Canonical name including the slash, e.g. "/ask". */
  name: string;
  /** Argument placeholder shown after the name, e.g. "<question>". */
  arg?: string;
  /** Description lines; the menu shows the first, /help shows all. */
  desc: string[];
}

/** Commands whose name starts with "/" + filter (case-insensitive prefix). */
export function filterCommands(commands: CommandSpec[], filter: string): CommandSpec[] {
  const prefix = `/${filter}`.toLowerCase();
  return commands.filter((c) => c.name.toLowerCase().startsWith(prefix));
}

/** The leading /command token of `line` when it names a known command. */
export function commandToken(line: string, commands: CommandSpec[]): string | null {
  const m = /^(\/\S+)/.exec(line);
  if (!m) return null;
  return commands.some((c) => c.name.toLowerCase() === m[1].toLowerCase()) ? m[1] : null;
}

/**
 * Menu rows: one per command (`❯` on the selection, name, arg, first desc
 * line) plus a key-hint row. No matches → a single dim row instead.
 */
export function renderMenu(items: CommandSpec[], selected: number, s: Styler): string[] {
  if (items.length === 0) return [s.dim("no matching command")];
  const rows = items.map((c, i) => {
    const marker = i === selected ? s.cyan("❯") : " ";
    return `${marker} ${s.bold(s.cyan(c.name))}${c.arg ? ` ${s.dim(c.arg)}` : ""}  ${s.dim(c.desc[0])}`;
  });
  rows.push(s.dim("[Up/Down select - Enter accept - Esc close]"));
  return rows;
}

/** Visible width of an ANSI-styled string (SGR codes take no columns). */
export function visibleWidth(text: string): number {
  return text.replace(/\x1b\[[0-9;]*m/g, "").length;
}
