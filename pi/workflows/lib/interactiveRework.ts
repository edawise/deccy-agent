// interactiveRework — Shared terminal REPL loop for workflow rework sessions.
// Copied from edagent workflows/lib/interactiveRework.ts (MIT,
// https://github.com/edawise/edagent) with the same behavior: readline prompt
// lifecycle, /exit commands, graceful SIGINT, turn execution, and live
// ephemeral thinking display for reasoning models.

import readline from "node:readline";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import type { StageSession } from "./stageJson.ts";

export interface InteractiveLoopOptions {
  banner?: string;
  promptLabel: string;
  /** Override the /help text (workflow-specific command lists). */
  helpText?: string;
  onTurn: (userInput: string) => Promise<string | void>;
  onCommand?: (command: string, arg: string) => Promise<string | void> | string | void;
  inputStream?: NodeJS.ReadableStream;
  outputStream?: NodeJS.WritableStream;
  session?: StageSession;
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

/**
 * Runs an interactive CLI REPL loop until the user types /exit, exit, /quit, quit, or sends SIGINT/EOF.
 */
export async function runInteractiveReworkLoop(options: InteractiveLoopOptions): Promise<void> {
  const input = options.inputStream ?? defaultInput;
  const output = options.outputStream ?? defaultOutput;

  const rl = readline.createInterface({
    input: input as any,
    output: output as any,
    terminal: Boolean((input as any).isTTY),
  });

  if (options.banner) {
    output.write(`${options.banner}\n\n`);
  }

  output.write(options.promptLabel);

  const cleanupThinking = setupVanishingThinking(options.session, output);

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) {
        output.write(options.promptLabel);
        continue;
      }

      if (
        trimmed === "/exit" ||
        trimmed === "exit" ||
        trimmed === "/quit" ||
        trimmed === "quit"
      ) {
        output.write("\nExiting interactive rework session.\n");
        break;
      }

      if (trimmed === "/help" || trimmed === "help") {
        output.write(
          options.helpText ??
            `
Available commands:
  /check, /status   Inspect current vault on disk without calling LLM
  /exit, /quit      Exit interactive rework session
  /help             Show this help message

Any other input is sent to the rework agent as directives/feedback.
\n`,
        );
        output.write(options.promptLabel);
        continue;
      }

      if ((trimmed.startsWith("/") || trimmed === "status" || trimmed === "check") && options.onCommand) {
        const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
        const spaceIdx = normalized.indexOf(" ");
        const cmd = spaceIdx === -1 ? normalized : normalized.slice(0, spaceIdx);
        const rest = spaceIdx === -1 ? "" : normalized.slice(spaceIdx + 1).trim();
        const cmdResult = await options.onCommand(cmd, rest);
        if (cmdResult) {
          output.write(`\n${cmdResult}\n`);
        }
        output.write(options.promptLabel);
        continue;
      }

      try {
        const result = await options.onTurn(trimmed);
        if (result) {
          output.write(`\n${result}\n`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        output.write(`\n[error] rework turn failed: ${msg}\n`);
      }

      output.write(options.promptLabel);
    }
  } finally {
    cleanupThinking();
    rl.close();
  }
}
