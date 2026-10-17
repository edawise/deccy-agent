// stageJson — the fenced-JSON seam shared by the deccy stage runners.
// Adapted from edagent's workflows/lib/stageJson.ts
// (MIT, https://github.com/edawise/edagent) plus the rca-planner controller's
// local JSON helpers (jsonFenceSafe / stripRawWsInStrings).
//
// The structured-output convention is prompt-based + controller-side parse:
// the agent answers with fenced ```json block(s); the parser slices from the
// opening "```json" to the LAST fence in the message (the agent may have
// fenced prose around it), falling back to the raw text when no fence exists.

export interface StageSession {
  prompt(p: string): Promise<string>;
  close?(): void;
  subscribe?(listener: (event: any) => void): () => void;
  /** Narrow/restore the active tool set around a turn (optional; SDK-backed).
   * Absent on test stubs — callers must treat it as a no-op. */
  setTools?(toolNames: string[]): void;
}

/** Session factories may be sync (test mocks) or async (SDK wiring). The
 * optional `attempt` (0-based) lets a stage escalate its session (e.g. raise
 * thinking) on corrective retries. Existing zero-arg stubs satisfy this
 * signature unchanged — `attempt` is optional, so `sessionOverrides` keep
 * working without modification. */
export type StageSessionFactory = (attempt?: number) => StageSession | Promise<StageSession>;

/** Extract the fenced ```json payload, or null when no fence is present. */
export function jsonBlockPayload(text: string): string | null {
  const open = text.indexOf("```json");
  if (open === -1) return null;
  const bodyStart = open + "```json".length;
  const bodyEnd = text.lastIndexOf("```");
  if (bodyEnd <= bodyStart) return text.slice(bodyStart);
  return text.slice(bodyStart, bodyEnd);
}

export type FencedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** Parse an agent answer into its fenced JSON value (loud on failure). */
export function parseFencedJson(text: string): FencedJsonResult {
  const payload = jsonBlockPayload(text) ?? text;
  try {
    return { ok: true, value: JSON.parse(payload) };
  } catch (err) {
    return { ok: false, error: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Parse EVERY fenced ```json block in a message (the plan-author seam emits
 * one block per plan section). Each block must be valid JSON on its own.
 */
export function parseAllFencedJson(text: string): { values: unknown[]; errors: string[] } {
  const values: unknown[] = [];
  const errors: string[] = [];
  const re = /```json[^\S\r\n]*\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const bodyStart = match.index + match[0].length;
    const endMarker = text.indexOf("```", bodyStart);
    const bodyEnd = endMarker === -1 ? text.length : endMarker;
    const body = text.slice(bodyStart, bodyEnd);
    try {
      values.push(JSON.parse(body));
    } catch (err) {
      errors.push(
        `block ${values.length + 1} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (endMarker === -1) break;
    re.lastIndex = endMarker + 3;
  }
  return { values, errors };
}

/**
 * Serialize a value for embedding in a fenced ```json block. JSON.stringify
 * does not escape backticks, so agent text quoting a fenced snippet would
 * emit a ``` sequence inside the block and truncate any later parse of the
 * payload. Escaping each backtick of a triple run as \u0060 keeps the JSON
 * valid and round-trips back to ` under JSON.parse.
 */
export function jsonFenceSafe(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/```/g, "\\u0060\\u0060\\u0060");
}

/** Drop raw \n / \r / \t bytes that appear INSIDE JSON string literals
 * (string-state aware, escape-aware). Everything outside strings passes
 * through untouched. Models emit literal control whitespace inside strings
 * when a value holds long markdown text; this makes one recovery pass work. */
export function stripRawWsInStrings(payload: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of payload) {
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) {
      escaped = false;
      out += ch;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }
    if (ch === "\n" || ch === "\r" || ch === "\t") continue;
    out += ch;
  }
  return out;
}

/** Single-block extraction with the lenient control-whitespace recovery pass. */
export function extractJson(text: string): { ok: true; value: any } | { ok: false; reason: string } {
  const payload = jsonBlockPayload(text);
  if (payload === null) return { ok: false, reason: "no fenced ```json block in final response" };
  try {
    return { ok: true, value: JSON.parse(payload) };
  } catch (err) {
    const firstReason = err instanceof Error ? err.message : String(err);
    try {
      return { ok: true, value: JSON.parse(stripRawWsInStrings(payload)) };
    } catch {
      return { ok: false, reason: `fenced block is not valid JSON (${firstReason})` };
    }
  }
}
