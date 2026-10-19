// pathComplete — Tab completion of file/folder paths for the workflow REPL.
//
// Word-level, matching readline's `completer` contract exactly: the completer
// is handed the line UP TO THE CURSOR and returns `[matches, completeOn]`,
// where every match is a full replacement of `completeOn` — the trailing word.
// Node then inserts the common prefix, or (on a second Tab) lists the matches.
// Because `completeOn` is taken as the literal suffix before the cursor, this
// is cursor-correct even mid-line.
//
// Paths resolve against a root (the graph repo). `./`, `../` and `~/` are
// allowed and the replacement keeps the prefix exactly as typed. Directories
// complete with a trailing "/" so the next Tab descends into them. Noise stays
// out: `node_modules` and VCS dirs (.git/.jj) are never suggested, and
// dot-entries only when the word itself starts with "." (explicit intent).
// Words starting with "/" return nothing — slash commands belong to the
// REPL's command surface, not to path completion.

import { readdirSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Never suggested, however they are typed. */
const EXCLUDED = new Set(["node_modules", ".git", ".jj"]);

/** Candidates for `word`: full replacements of it, empty when nothing matches. */
export function completePathWord(word: string, root: string): string[] {
  if (word.startsWith("/")) return []; // slash commands, not paths
  const slash = word.lastIndexOf("/");
  const dirPart = slash === -1 ? "" : word.slice(0, slash + 1); // typed, kept as-is
  const basePart = slash === -1 ? word : word.slice(slash + 1);
  const dir = resolveDir(dirPart, root);
  if (dir === null) return [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const matches: { name: string; isDir: boolean }[] = [];
  for (const e of entries) {
    if (EXCLUDED.has(e.name)) continue;
    if (e.name.startsWith(".") && !basePart.startsWith(".")) continue;
    if (!e.name.startsWith(basePart)) continue;
    matches.push({ name: e.name, isDir: isDirectory(dir, e) });
  }
  // Dirs first (descendable), then codepoint order — deterministic for tests.
  matches.sort((a, b) =>
    a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  return matches.map((m) => `${dirPart}${m.name}${m.isDir ? "/" : ""}`);
}

/** readline `completer` for paths under `root` (see module docs for the contract). */
export function makePathCompleter(root: string): (line: string) => [string[], string] {
  return (line) => {
    const word = /(\S*)$/.exec(line)?.[0] ?? "";
    return [completePathWord(word, root), word];
  };
}

/** Resolve the typed directory prefix against root (~ and ./../ are honored). */
function resolveDir(dirPart: string, root: string): string | null {
  let p = dirPart;
  if (p === "~" || p.startsWith("~/")) p = path.join(os.homedir(), p.slice(1));
  try {
    return statSync(path.resolve(root, p)).isDirectory() ? path.resolve(root, p) : null;
  } catch {
    return null;
  }
}

/** Dirent dir-ness, following symlinks (a link to a dir completes like one). */
function isDirectory(dir: string, entry: Dirent): boolean {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return statSync(path.join(dir, entry.name)).isDirectory();
  } catch {
    return false;
  }
}
