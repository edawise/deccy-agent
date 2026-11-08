/**
 * deccy-role.ts — deccy role enforcement for the Pi port.
 *
 * Loaded for a deccy root session by `pi/deccy-pi` (`pi -e .../deccy-role.ts`),
 * and optionally auto-discovered from `$PI_CODING_AGENT_DIR/extensions/` or
 * `<project>/.pi/extensions/`. It has four jobs:
 *
 * 1. Make the root role's agent file govern the session by appending the
 *    `active_agent` session entry. The policy comes from the `<role>.md`
 *    frontmatter.
 * 2. Add the root role body to the system prompt on every root run. The body is
 *    a section placed after Pi's `<cwd>` section, so a subagent — which inherits
 *    only the parent identity above `<cwd>` — does not inherit the root
 *    instructions. This also lets the interactive TUI start idle: the role is
 *    supplied when the first message arrives, not as a message at launch.
 * 3. Refuse to append the root entry, or add the root section, in a subagent
 *    child. Children get their identity from their own agent file
 *    (`<active_agent>` in their system prompt); the root instructions must not
 *    leak into them.
 * 4. Gate the `subagent` tool: only an orchestrator root may spawn, and only the
 *    four worker roles. Unknown names fail closed instead of falling back to
 *    `general-purpose`.
 *
 * Child detection uses both signals the subagents package offers:
 * - `subagents:child:session-created` / `:disposed` (synchronous, before the child
 *   binds its extensions), shared in a Symbol-backed set so every copy of this
 *   extension in the process sees it;
 * - the child session header's `parentSession`, which subagents sets with
 *   `newSession({ parentSession })`. A session whose `session_start` reason is
 *   `fork` is a user fork of the root, not a child, so it stays a root.
 *
 * This guards the deccy invariants; it is not a sandbox. The permission system
 * (`@gotgenes/pi-permission-system`) enforces the file, shell and skill policy.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  ExtensionAPI,
  ExtensionContext,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

const CHILD_CREATED = "subagents:child:session-created";
const CHILD_DISPOSED = "subagents:child:disposed";

const ROOT_ROLES = new Set(["plan", "orchestrator"]);
const ALLOWED_SUBAGENTS = [
  "deccy-plan",
  "deccy-gate-author",
  "deccy-drafter",
  "deccy-judge",
] as const;
const ALLOWED_SUBAGENT_SET = new Set(ALLOWED_SUBAGENTS.map((name) => name.toLowerCase()));

const CHILD_REGISTRY = Symbol.for("deccy.role.childSessions");
const ROOT_REGISTRY = Symbol.for("deccy.role.rootSessions");

type GlobalWithRegistries = typeof globalThis & {
  [CHILD_REGISTRY]?: Set<string>;
  [ROOT_REGISTRY]?: Set<string>;
};

function childSessions(): Set<string> {
  const global = globalThis as GlobalWithRegistries;
  let set = global[CHILD_REGISTRY];
  if (!set) {
    set = new Set<string>();
    global[CHILD_REGISTRY] = set;
  }
  return set;
}

function rootSessions(): Set<string> {
  const global = globalThis as GlobalWithRegistries;
  let set = global[ROOT_REGISTRY];
  if (!set) {
    set = new Set<string>();
    global[ROOT_REGISTRY] = set;
  }
  return set;
}

type DeccyRole =
  | { status: "none" }
  | { status: "invalid"; raw: string }
  | { status: "ok"; role: string };

/**
 * Resolve `DECCY_ROLE`. The launcher sets the full name (`deccy-plan`);
 * a hand-written value of `plan` is accepted too. Anything else is invalid and
 * fails closed at the subagent gate.
 */
function resolveDeccyRole(): DeccyRole {
  const raw = process.env.DECCY_ROLE;
  if (!raw || raw.trim() === "") return { status: "none" };
  const trimmed = raw.trim();
  const name = trimmed.startsWith("deccy-")
    ? trimmed.slice("deccy-".length)
    : trimmed;
  if (!ROOT_ROLES.has(name)) return { status: "invalid", raw };
  return { status: "ok", role: name };
}

function sessionId(ctx: ExtensionContext): string {
  try {
    return ctx.sessionManager.getSessionId();
  } catch {
    return "unknown";
  }
}

function parentSessionOf(ctx: ExtensionContext): string | undefined {
  try {
    return ctx.sessionManager.getHeader()?.parentSession;
  } catch {
    return undefined;
  }
}

/**
 * A session is a child when the subagents package announced it, or when its
 * header names a parent and the session was not created by a user fork.
 */
function isChildSession(ctx: ExtensionContext, reason: SessionStartEvent["reason"]): boolean {
  const id = sessionId(ctx);
  if (childSessions().has(id)) return true;
  if (parentSessionOf(ctx) && reason !== "fork") return true;
  return false;
}

/**
 * A root for a `before_agent_start` turn. `session_start` records every
 * non-child in `rootSessions`, which also covers a user fork; the parent
 * header is the fallback when the announcement was missed.
 */
function isRootContext(ctx: ExtensionContext): boolean {
  const id = sessionId(ctx);
  if (childSessions().has(id)) return false;
  if (parentSessionOf(ctx) && !rootSessions().has(id)) return false;
  return true;
}

/** The launcher's role file, or the bundle's copy for a hand-set DECCY_ROLE. */
function roleFilePath(): string | undefined {
  const explicit = process.env.DECCY_ROLE_FILE;
  if (explicit && explicit.trim() !== "") return explicit;

  const role = resolveDeccyRole();
  const bundle = process.env.DECCY_BUNDLE;
  if (role.status === "ok" && bundle && bundle.trim() !== "") {
    return join(bundle, "pi", "agents", `deccy-${role.role}.md`);
  }
  return undefined;
}

/** The body of a role file: everything after the leading YAML frontmatter. */
function roleBodyFromFile(path: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    console.error(`deccy-role: cannot read role body ${path}: ${String(error)}`);
    return undefined;
  }

  const lines = text.split(/\r?\n/);
  let index = 0;
  if (lines[0]?.trim() === "---") {
    index = 1;
    while (index < lines.length && lines[index].trim() !== "---") index += 1;
    if (index < lines.length) index += 1;
  }
  while (index < lines.length && lines[index].trim() === "") index += 1;

  const body = lines.slice(index).join("\n").trimEnd();
  return body === "" ? undefined : body;
}

function block(reason: string): { block: true; reason: string } {
  return { block: true, reason: `deccy-role: ${reason}` };
}

export default function deccyRole(pi: ExtensionAPI): void {
  // Register child sessions synchronously: the package emits `session-created`
  // immediately before the child binds its extensions, so the set is populated
  // before any child `session_start` handler runs.
  pi.events.on(CHILD_CREATED, (data) => {
    const payload = data as { sessionId?: string };
    if (payload?.sessionId) childSessions().add(payload.sessionId);
  });
  pi.events.on(CHILD_DISPOSED, (data) => {
    const payload = data as { sessionId?: string };
    if (payload?.sessionId) childSessions().delete(payload.sessionId);
  });

  pi.on("session_start", (event, ctx) => {
    const role = resolveDeccyRole();
    if (role.status === "none") return;

    const id = sessionId(ctx);
    const child = isChildSession(ctx, event.reason);
    if (child) {
      childSessions().add(id);
      return;
    }

    // Record the root so the subagent gate can tell a launcher root from a child
    // in the same process, even if the child event was missed.
    rootSessions().add(id);

    if (role.status === "invalid") {
      console.error(
        `deccy-role: DECCY_ROLE=${JSON.stringify(role.raw)} is not a deccy root role ` +
          `(expected plan or orchestrator); no active_agent entry was appended`,
      );
      return;
    }

    // Latest entry wins. Appending on reload/new resumes the policy with the
    // same role; the system section is added again on every root run.
    pi.appendEntry("active_agent", { name: `deccy-${role.role}` });
  });

  pi.on("before_agent_start", (event, ctx) => {
    const role = resolveDeccyRole();
    if (role.status !== "ok") return undefined;
    if (!isRootContext(ctx)) return undefined;

    const path = roleFilePath();
    if (!path) return undefined;
    const body = roleBodyFromFile(path);
    if (!body) return undefined;

    const text = `Role: deccy-${role.role}\n\n${body}`;

    // A custom section lands after Pi's `<cwd>` section. The subagents package
    // inherits only the parent identity above `<cwd>`, so children never see it.
    if (event.systemPromptOptions?.sections) {
      event.systemPromptOptions.sections.deccy_role = text;
      return undefined;
    }

    // Older Pi without mutable sections: append after the rendered prompt.
    return {
      systemPrompt: `${event.systemPrompt}\n\n<deccy_role>\n${text}\n</deccy_role>`,
    };
  });

  pi.on("tool_call", (event, ctx) => {
    if (event.toolName !== "subagent") return undefined;

    const id = sessionId(ctx);

    // Children never get the subagent tool from the package, but the process
    // environment still carries the root role. Fail closed if it appears anyway.
    if (childSessions().has(id) || (parentSessionOf(ctx) && !rootSessions().has(id))) {
      return block(
        "a deccy subagent may not spawn another subagent; return the work to the orchestrator",
      );
    }

    const role = resolveDeccyRole();
    if (role.status === "none") return undefined;
    if (role.status === "invalid") {
      return block(
        `DECCY_ROLE=${JSON.stringify(role.raw)} is not a deccy root role; subagent dispatch refused`,
      );
    }
    if (role.role !== "orchestrator") {
      return block(
        `the ${role.role} role may not spawn subagents; only deccy-orchestrator may`,
      );
    }

    const input = event.input as Record<string, unknown>;
    const rawType = input.subagent_type ?? input.agent;
    if (typeof rawType !== "string" || rawType.trim() === "") {
      return block(
        `subagent requires an explicit subagent_type (allowed: ${ALLOWED_SUBAGENTS.join(", ")})`,
      );
    }

    // The package resolves types case-insensitively; the gate does the same so a
    // differently-cased allowed name is not rejected after it would have run.
    const type = rawType.trim().toLowerCase();
    if (!ALLOWED_SUBAGENT_SET.has(type)) {
      return block(
        `subagent_type ${JSON.stringify(rawType)} is not allowed ` +
          `(allowed: ${ALLOWED_SUBAGENTS.join(", ")})`,
      );
    }

    return undefined;
  });
}
