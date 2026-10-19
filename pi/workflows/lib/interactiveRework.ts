// interactiveRework — Shared terminal REPL loop for workflow rework sessions.
// Copied from edagent workflows/lib/interactiveRework.ts (MIT,
// https://github.com/edawise/edagent) with the same behavior: readline prompt
// lifecycle, /exit commands, graceful SIGINT, turn execution, and live
// ephemeral thinking display for reasoning models.
//
// This fork adds the "/" command menu (commandMenu.ts): typing "/" as the
// first character of an empty line pops up the commands, typing narrows the
// list, Up/Down select and Enter accepts the command into the prompt line
// (repainted in color) — never submitting it. Menu keys are claimed by the
// PasteFilter before readline can act on them (see keyFilter/menukey there).

import readline from "node:readline";
import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import type { StageSession } from "./stageJson.ts";
import { BRACKETED_PASTE_OFF, BRACKETED_PASTE_ON, PasteFilter } from "./pasteFilter.ts";
import {
  commandToken,
  filterCommands,
  renderMenu,
  visibleWidth,
  type CommandSpec,
} from "./commandMenu.ts";
import { styleFor } from "./ttyStyle.ts";

export interface InteractiveLoopOptions {
  banner?: string;
  promptLabel: string;
  /** Override the /help text (workflow-specific command lists). */
  helpText?: string;
  onTurn: (userInput: string) => Promise<string | void>;
  onCommand?: (command: string, arg: string) => Promise<string | void> | string | void;
  /** readline `completer` for Tab — e.g. makePathCompleter(graphDir). Gets the
   *  line up to the cursor, returns [matches, completeOn] (see pathComplete). */
  completer?: (line: string) => [string[], string];
  /** Slash-command specs for the "/" menu (see commandMenu.ts). */
  commands?: CommandSpec[];
  inputStream?: NodeJS.ReadableStream;
  outputStream?: NodeJS.WritableStream;
  session?: StageSession;
  /** Ctrl-G "compose in editor" opener (test seam; default: $VISUAL/$EDITOR/vi). */
  openEditor?: (initial: string) => Promise<string | null>;
}

/**
 * Attaches a vanishing thinking display to an agent session.
 * Displays an in-place spinner + elapsed timer + thought excerpt on TTY streams,
 * and completely clears the line (\r\x1b[2K) when thinking finishes.
 */
export function setupVanishingThinking(
  session: { subscribe?: (listener: (event: any) => void) => () => void } | undefined,
  output: NodeJS.WritableStream,
): () => void {
  if (!session?.subscribe || !Boolean((output as any).isTTY)) {
    return () => {};
  }

  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frameIdx = 0;
  let spinnerTimer: NodeJS.Timeout | null = null;
  let startTime = 0;
  let currentThoughtSnippet = "";
  let isThinking = false;

  const render = () => {
    if (!isThinking) return;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const frame = frames[frameIdx++ % frames.length];
    const cols = (output as any).columns || 80;
    const maxSnippet = Math.max(10, cols - 32);
    const snippet = currentThoughtSnippet.slice(-maxSnippet).trim();
    const text = snippet ? `${frame} Thinking (${elapsed}s)... ${snippet}` : `${frame} Thinking (${elapsed}s)...`;
    output.write(`\r\x1b[2K\x1b[90m${text}\x1b[0m`);
  };

  const clear = () => {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
    if (isThinking) {
      isThinking = false;
      output.write("\r\x1b[2K");
    }
  };

  const unsubscribe = session.subscribe((event: any) => {
    if (!event) return;
    if (event.type === "message_update") {
      const aEv = event.assistantMessageEvent;
      if (aEv) {
        if (aEv.type === "thinking_start") {
          isThinking = true;
          startTime = Date.now();
          currentThoughtSnippet = "";
          if (!spinnerTimer) {
            spinnerTimer = setInterval(render, 80);
          }
          render();
        } else if (aEv.type === "thinking_delta") {
          if (!isThinking) {
            isThinking = true;
            startTime = Date.now();
            if (!spinnerTimer) {
              spinnerTimer = setInterval(render, 80);
            }
          }
          if (typeof aEv.delta === "string") {
            const cleaned = aEv.delta.replace(/\s+/g, " ");
            currentThoughtSnippet += cleaned;
          }
          render();
        } else if (
          aEv.type === "thinking_end" ||
          aEv.type === "text_start" ||
          aEv.type === "toolcall_start"
        ) {
          clear();
        }
      }
    } else if (
      event.type === "turn_end" ||
      event.type === "agent_end" ||
      event.type === "message_end"
    ) {
      clear();
    }
  });

  return () => {
    clear();
    try {
      unsubscribe?.();
    } catch {
      /* best effort */
    }
  };
}

/**
 * Persistent thinking stream for non-interactive runs: prints each thinking
 * block to `output` as it streams (header + raw deltas + closing newline),
 * unlike the vanishing TTY display above. Returns an unsubscribe function.
 */
export function streamThinking(
  session: { subscribe?: (listener: (event: any) => void) => () => void } | undefined,
  output: NodeJS.WritableStream,
  label = "thinking",
): () => void {
  if (!session?.subscribe) return () => {};
  let open = false;
  const unsubscribe = session.subscribe((event: any) => {
    const aEv = event?.type === "message_update" ? event.assistantMessageEvent : null;
    if (!aEv) return;
    if (aEv.type === "thinking_end") {
      if (open) {
        open = false;
        output.write("\n");
      }
      return;
    }
    if (aEv.type === "thinking_start" || (aEv.type === "thinking_delta" && !open)) {
      open = true;
      output.write(`[${label}]\n`);
    }
    if (aEv.type === "thinking_delta" && typeof aEv.delta === "string") {
      output.write(aEv.delta);
    }
  });
  return () => {
    if (open) output.write("\n");
    try {
      unsubscribe?.();
    } catch {
      /* best effort */
    }
  };
}

/** Default Ctrl-G opener: write `initial` to a temp file, run $VISUAL/$EDITOR
 *  with inherited stdio, return the file's content (empty = cancel). */
export async function defaultOpenInEditor(
  initial: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const editor = (env.VISUAL || env.EDITOR || "vi").trim();
  const file = path.join(tmpdir(), `deccy-prompt-${process.pid}-${Date.now()}.md`);
  await writeFile(file, initial);
  try {
    await new Promise<void>((resolve, reject) => {
      // The temp file is appended (quoted) to the editor command: editors
      // launched with no file argument just open an empty window/buffer.
      // Quoting keeps `EDITOR="code --wait"`-style commands working.
      const child = spawn(`${editor} "${file}"`, { stdio: "inherit", shell: true });
      child.on("error", reject);
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${editor} exited with code ${code}`))));
    });
    return await readFile(file, "utf8");
  } finally {
    await rm(file, { force: true });
  }
}

/**
 * Runs an interactive CLI REPL loop until the user types /exit, exit, /quit, quit, or sends SIGINT/EOF.
 *
 * Inputs are handled as *logical* inputs through one queue: a readline line, a
 * bracketed multi-line paste (one `paste` event from the PasteFilter), and
 * Ctrl-G editor results all become one turn each. A multi-line paste is
 * submitted whole — newlines intact — instead of one turn per `\n`.
 */
export async function runInteractiveReworkLoop(options: InteractiveLoopOptions): Promise<void> {
  const input = options.inputStream ?? defaultInput;
  const output = options.outputStream ?? defaultOutput;
  const s = styleFor(output);
  const isTTY = Boolean((input as any).isTTY);
  const openEditor = options.openEditor ?? defaultOpenInEditor;

  // stdin → pasteFilter → readline: bracketed paste regions are swallowed by
  // the filter (readline would split them at every `\n`) and surface as one
  // `paste` event; everything else passes through byte-for-byte.
  const pasteFilter = new PasteFilter();
  (pasteFilter as any).isTTY = isTTY;
  (pasteFilter as any).setRawMode = (mode: boolean) => (input as any).setRawMode?.(mode);
  (input as NodeJS.ReadableStream).pipe?.(pasteFilter as any);

  const rl = readline.createInterface({
    input: pasteFilter as any,
    output: output as any,
    terminal: isTTY,
    completer: options.completer as any,
  });
  if (isTTY) output.write(BRACKETED_PASTE_ON);

  // Logical-input queue: lines, pastes and editor results are dispatched
  // strictly in arrival order, one at a time, even while a turn is running.
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const push = (text: string) => {
    queue.push(text);
    wake?.();
  };
  const clearLine = () => {
    // Wipe whatever was typed at the prompt (terminal line editing only).
    try {
      rl.write(null, { ctrl: true, name: "u" } as any);
    } catch {
      /* non-terminal input: nothing on screen */
    }
  };

  // Staged input: pastes are echoed for review and run on Enter — a paste
  // never submits by itself.
  let pending = "";

  rl.on("line", (line) => {
    if (pending) {
      const text = line.trim() ? `${pending}\n${line}` : pending;
      pending = "";
      push(text);
      return;
    }
    push(line);
  });
  rl.on("close", () => {
    closed = true;
    wake?.();
  });

  pasteFilter.on("paste", (raw) => {
    closeMenu();
    const normalized = raw.replace(/\r\n/g, "\n");
    const body = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
    const typed = rl.line ?? "";
    if (body.includes("\n")) {
      // Multi-line paste: show it, stage it, and wait for Enter.
      const text = typed ? typed + body : body;
      clearLine();
      output.write(`${text}\n`);
      const lines = text.split("\n").length;
      output.write(s.dim(`[pasted ${lines} line${lines === 1 ? "" : "s"} — Enter runs it]\n`));
      pending = pending ? `${pending}\n${text}` : text;
      output.write(options.promptLabel);
      return;
    }
    // Single line (with or without its trailing newline): land it in the
    // prompt line for review — Enter runs it, like anything typed.
    rl.write(body);
  });

  // ── "/" command menu (TTY only; needs options.commands) ─────────────────
  //
  // Opens only when "/" is typed as the very first character of an empty
  // line (real typing — `rl.write`-landed pastes and editor buffers emit no
  // keypress and can never open it), narrows as the user types, and Enter
  // ACCEPTS the highlighted command into the prompt line — repainted in
  // color — without submitting a turn. While the menu is open,
  // Up/Down/Enter/Tab/Esc are swallowed by the PasteFilter BEFORE readline
  // sees them (keyFilter/menukey there), so they move the selection instead
  // of the cursor/history and Enter accepts instead of submitting. The menu
  // is a redrawn region below the prompt row; the prompt row is repainted so
  // an accepted command stays visible in color while its args are typed.
  // Guarded by `editing`: while the Ctrl-G editor composes (vim, VS Code,
  // anything), nothing here triggers — and the editor's keystrokes are
  // dropped, never replayed into the prompt.
  const commands = options.commands ?? [];
  let editing = false; // true while the Ctrl-G editor owns the terminal
  let menu: { items: CommandSpec[]; selected: number } | null = null;
  let painted = false; // the prompt row currently shows a colored command
  let menuShown = false; // the region below the prompt currently shows rows

  /** Redraw the prompt row (with a colored command token) + the menu region. */
  const repaint = () => {
    if (!isTTY) return;
    const line = rl.line ?? "";
    const token = commandToken(line, commands);
    const color = Boolean(token) && s.enabled;
    const rows = menu ? renderMenu(menu.items, menu.selected, s) : [];
    if (!menu && !color && !painted && !menuShown) return; // screen already correct
    const cols = (output as any).columns || 80;
    // Wrapped prompt row: leave readline's plain rendering alone (v1).
    if (visibleWidth(options.promptLabel) + visibleWidth(line) >= cols) return;
    let out = `\r\x1b[0J${options.promptLabel}${color ? s.bold(s.cyan(token!)) + line.slice(token!.length) : line}`;
    if (rows.length > 0) out += `\r\n${rows.join("\r\n")}`;
    const up = rows.reduce((n, r) => n + Math.max(1, Math.ceil(visibleWidth(r) / cols)), 0);
    if (up > 0) out += `\x1b[${up}A`;
    out += `\r\x1b[${visibleWidth(options.promptLabel) + rl.cursor + 1}G`;
    output.write(out);
    painted = color;
    menuShown = rows.length > 0;
  };

  const closeMenu = () => {
    if (!menu) return;
    menu = null;
    (pasteFilter as any).keyFilter = null;
    repaint();
  };

  /** Keys the open menu claims from the input (see PasteFilter.keyFilter). */
  const menuKeys = (unit: string): boolean => {
    if (!menu) return false;
    if (unit === "\x1b") return true; // Esc closes the menu
    const nav = unit === "\x1b[A" || unit === "\x1bOA" || unit === "\x1b[B" || unit === "\x1bOB";
    const accept = unit === "\r" || unit === "\n" || unit === "\t";
    return (nav || accept) && menu.items.length > 0;
  };

  pasteFilter.on("menukey", (unit) => {
    if (!menu) return;
    if (unit === "\x1b") {
      closeMenu();
      return;
    }
    const n = menu.items.length;
    if (unit === "\x1b[A" || unit === "\x1bOA") {
      menu = { ...menu, selected: (menu.selected - 1 + n) % n };
      repaint();
      return;
    }
    if (unit === "\x1b[B" || unit === "\x1bOB") {
      menu = { ...menu, selected: (menu.selected + 1) % n };
      repaint();
      return;
    }
    // Enter / Tab: accept the highlighted command into the line — never submit.
    const item = menu.items[menu.selected];
    menu = null;
    (pasteFilter as any).keyFilter = null;
    clearLine();
    rl.write(item.arg ? `${item.name} ` : item.name);
    repaint();
  });

  /** Menu maintenance + colored repaint — runs after readline handled a key. */
  const syncMenu = (str: string) => {
    if (editing) return;
    const line = rl.line ?? "";
    if (!menu && str === "/" && line === "/" && rl.cursor === 1 && !pending && commands.length > 0) {
      menu = { items: filterCommands(commands, ""), selected: 0 };
      (pasteFilter as any).keyFilter = menuKeys;
      repaint();
      return;
    }
    if (menu) {
      if (line.startsWith("/") && !/\s/.test(line) && rl.cursor === line.length) {
        const items = filterCommands(commands, line.slice(1));
        if (items.length !== menu.items.length || items.some((c, i) => c !== menu.items[i])) {
          menu = { items, selected: 0 }; // filter changed: reselect from the top
        }
      } else {
        menu = null;
        (pasteFilter as any).keyFilter = null;
      }
    }
    repaint();
  };

  // Ctrl-G: compose the prompt in $VISUAL/$EDITOR (save+exit runs it, empty cancels).
  (pasteFilter as any).on("keypress", (_str: string, key: { ctrl?: boolean; name?: string } | undefined) => {
    if (editing || !key?.ctrl || key.name !== "g") return;
    editing = true;
    void (async () => {
      // Open with everything composed so far (staged paste + typed line) so it
      // can be edited as one buffer.
      const typedLine = rl.line ?? "";
      const initial = pending ? (typedLine ? `${pending}\n${typedLine}` : pending) : typedLine;
      clearLine();
      closeMenu();
      try {
        output.write(
          s.dim(
            '[editor: write your prompt, then save+exit — it gets staged and Enter runs it; quit without saving to cancel (vim: Esc, then :wq or :q!)]\n',
          ),
        );
        // The editor owns the terminal now: detach our input so keystrokes
        // typed while composing (vim, VS Code, …) belong to the editor and
        // are never replayed into the prompt or the menu afterwards.
        (input as NodeJS.ReadableStream).unpipe?.(pasteFilter as any);
        (input as any).pause?.();
        (input as any).setRawMode?.(false);
        let edited: string | null;
        try {
          edited = await openEditor(initial);
        } finally {
          (input as any).setRawMode?.(true);
          (input as any).pause?.();
          (input as NodeJS.ReadableStream).pipe?.(pasteFilter as any);
        }
        if (edited && edited.trim()) {
          // Staged, like a paste: nothing runs without Enter.
          pending = edited.trimEnd();
          output.write(`${pending}\n`);
          output.write(s.dim("[editor buffer staged — Enter runs it]\n"));
          output.write(options.promptLabel);
        } else {
          output.write(`${s.dim("[editor cancelled]")}\n`);
          output.write(options.promptLabel);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        output.write(`\n${s.red(`[error] editor failed: ${msg}`)}\n`);
        output.write(options.promptLabel);
      } finally {
        editing = false;
      }
    })();
  });

  // Menu maintenance + colored repaint — registered after readline's keypress
  // handler, so rl.line already reflects the key that was just processed.
  (pasteFilter as any).on("keypress", (str: string) => syncMenu(str));

  const handleInput = async (raw: string): Promise<"exit" | void> => {
    closeMenu();
    const trimmed = raw.trim();
    if (!trimmed) {
      output.write(options.promptLabel);
      return;
    }

    if (
      trimmed === "/exit" ||
      trimmed === "exit" ||
      trimmed === "/quit" ||
      trimmed === "quit"
    ) {
      output.write(`\n${s.dim("Exiting interactive rework session.")}\n`);
      return "exit";
    }

    if (trimmed === "/help" || trimmed === "help") {
      output.write(
        options.helpText ??
          `
Available commands:
  /check, /status   Inspect current vault on disk without calling LLM
  /exit, /quit      Exit interactive rework session
  /help             Show this help message

Compose: Ctrl-G opens $VISUAL/$EDITOR for the prompt (empty cancels); a paste is
shown and staged — press Enter to run it. Anything else is a directive/feedback.
\n`,
      );
      output.write(options.promptLabel);
      return;
    }

    if ((trimmed.startsWith("/") || trimmed === "status" || trimmed === "check") && options.onCommand) {
      const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
      const spaceIdx = normalized.indexOf(" ");
      const cmd = spaceIdx === -1 ? normalized : normalized.slice(0, spaceIdx);
      const rest = spaceIdx === -1 ? "" : normalized.slice(spaceIdx + 1).trim();
      const cmdResult = await options.onCommand(cmd, rest);
      if (cmdResult) {
        output.write(`\n${s.border(cmdResult.trimEnd())}\n`);
      }
      output.write(options.promptLabel);
      return;
    }

    try {
      const result = await options.onTurn(trimmed);
      if (result) {
        output.write(`\n${s.border(result.trimEnd())}\n`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.write(`\n${s.red(`[error] rework turn failed: ${msg}`)}\n`);
    }

    output.write(options.promptLabel);
  };

  if (options.banner) {
    output.write(`${options.banner}\n\n`);
  }
  output.write(options.promptLabel);
  const cleanupThinking = setupVanishingThinking(options.session, output);

  try {
    for (;;) {
      while (queue.length > 0) {
        const action = await handleInput(queue.shift()!);
        if (action === "exit") return;
      }
      if (closed) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
    }
  } finally {
    cleanupThinking();
    if (isTTY) output.write(BRACKETED_PASTE_OFF);
    (input as NodeJS.ReadableStream).unpipe?.(pasteFilter as any);
    rl.close();
  }
}
