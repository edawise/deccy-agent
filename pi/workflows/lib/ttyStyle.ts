// ttyStyle — minimal ANSI styling for workflow REPL output.
// Zero dependencies: raw SGR codes, emitted only when the destination stream is
// an interactive TTY. Pipes (tests, subprocess capture, JSON consumers) get
// plain text. Standard overrides: NO_COLOR (non-empty) disables, FORCE_COLOR
// forces on ("0" disables), TERM=dumb disables.

const CODES = {
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
  reset: "\x1b[0m",
} as const;

export interface Styler {
  /** True when ANSI codes are actually being emitted. */
  enabled: boolean;
  bold(text: string): string;
  dim(text: string): string;
  red(text: string): string;
  green(text: string): string;
  yellow(text: string): string;
  cyan(text: string): string;
  magenta(text: string): string;
  gray(text: string): string;
  italic(text: string): string;
  /** Prefix every line with a dim `│` gutter so a reply reads as one block.
   * Identity when colors are off. */
  border(text: string): string;
}

/** Should this stream get ANSI styling? */
export function colorsEnabled(stream?: { isTTY?: boolean } | null): boolean {
  // Explicit FORCE_COLOR intent wins over NO_COLOR (supports-color precedence).
  const force = process.env.FORCE_COLOR;
  if (force !== undefined && force !== "") return force !== "0" && force !== "false";
  if (process.env.NO_COLOR) return false;
  if (process.env.TERM === "dumb") return false;
  return Boolean(stream?.isTTY);
}

/** Styler for a destination stream. Every function is identity when colors are off. */
export function styleFor(stream?: { isTTY?: boolean } | null): Styler {
  const enabled = colorsEnabled(stream);
  const paint =
    (code: string) =>
    (text: string): string =>
      enabled ? `${code}${text}${CODES.reset}` : text;
  const gray = paint(CODES.gray);
  return {
    enabled,
    bold: paint(CODES.bold),
    dim: paint(CODES.dim),
    red: paint(CODES.red),
    green: paint(CODES.green),
    yellow: paint(CODES.yellow),
    cyan: paint(CODES.cyan),
    magenta: paint(CODES.magenta),
    gray,
    italic: paint(CODES.italic),
    border(text: string): string {
      if (!enabled) return text;
      const gutter = paint(CODES.cyan)("│");
      return text
        .split("\n")
        .map((line) => (line.trim() ? `${gutter} ${line}` : gutter))
        .join("\n");
    },
  };
}
