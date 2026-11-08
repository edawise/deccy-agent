#!/usr/bin/env node
/**
 * Deterministic tests for `pi/extensions/deccy-role.ts`.
 *
 * Runs the extension against a fake `ExtensionAPI`; no Pi session or model call
 * is needed. Requires a Node that can load TypeScript directly (Node 23.6+;
 * pass `--experimental-strip-types` on 22.6+).
 *
 *   node pi/tests/deccy-role.test.mjs
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTENSION = join(HERE, "..", "extensions", "deccy-role.ts");
const { default: deccyRole } = await import(EXTENSION);

const CHILD_CREATED = "subagents:child:session-created";
const CHILD_DISPOSED = "subagents:child:disposed";

function makePi() {
  const handlers = new Map();
  const listeners = new Map();
  const entries = [];
  const pi = {
    on(name, fn) {
      handlers.set(name, fn);
    },
    events: {
      on(name, fn) {
        listeners.set(name, fn);
      },
    },
    appendEntry(type, data) {
      entries.push({ type, data });
    },
    getActiveTools() {
      return [];
    },
  };
  const emit = (name, data) => listeners.get(name)?.(data);
  return { pi, handlers, entries, emit };
}

function makeCtx(id, parentSession = null) {
  return {
    sessionManager: {
      getSessionId: () => id,
      getHeader: () => ({ type: "session", id, parentSession }),
    },
  };
}

const ROOT = makeCtx("root-1");
const CHILD = makeCtx("child-1", "root-1");

const TMP = mkdtempSync(join(tmpdir(), "deccy-role-test-"));
const ROLE_FILE = join(TMP, "deccy-plan.md");
writeFileSync(
  ROLE_FILE,
  "---\ndescription: test role\n---\n\nYou are the test planner.\n",
  "utf8",
);
process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));

function start(handlers, reason, ctx) {
  return handlers.get("session_start")({ type: "session_start", reason }, ctx);
}

function beforeStart(handlers, ctx, options) {
  const event = {
    type: "before_agent_start",
    messageType: "user",
    prompt: "hello",
    systemPrompt: "BASE PROMPT",
    systemPromptOptions:
      options === null ? undefined : { sections: {}, ...(options ?? {}) },
  };
  return { event, result: handlers.get("before_agent_start")(event, ctx) };
}

function spawn(handlers, input, ctx) {
  return handlers.get("tool_call")(
    { type: "tool_call", toolName: "subagent", toolCallId: "1", input },
    ctx,
  );
}

function withEnvVars(vars, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function withEnv(value, fn) {
  withEnvVars({ DECCY_ROLE: value }, fn);
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

// --- active_agent on root `session_start` ------------------------------------
test("orchestrator root appends active_agent", () => {
  withEnv("deccy-orchestrator", () => {
    const { pi, handlers, entries } = makePi();
    deccyRole(pi);
    start(handlers, "startup", ROOT);
    assert.deepEqual(entries, [{ type: "active_agent", data: { name: "deccy-orchestrator" } }]);
  });
});

test("plan root appends active_agent from the full name", () => {
  withEnv("deccy-plan", () => {
    const { pi, handlers, entries } = makePi();
    deccyRole(pi);
    start(handlers, "startup", makeCtx("root-plan"));
    assert.deepEqual(entries, [{ type: "active_agent", data: { name: "deccy-plan" } }]);
  });
});

test("reload re-appends the entry (latest wins)", () => {
  withEnv("deccy-plan", () => {
    const { pi, handlers, entries } = makePi();
    deccyRole(pi);
    start(handlers, "startup", ROOT);
    start(handlers, "reload", ROOT);
    assert.equal(entries.length, 2);
  });
});

test("no DECCY_ROLE is a no-op", () => {
  withEnv(undefined, () => {
    const { pi, handlers, entries } = makePi();
    deccyRole(pi);
    start(handlers, "startup", ROOT);
    assert.equal(entries.length, 0);
  });
});

test("an invalid DECCY_ROLE appends nothing", () => {
  withEnv("deccy-bogus", () => {
    const { pi, handlers, entries } = makePi();
    deccyRole(pi);
    start(handlers, "startup", ROOT);
    assert.equal(entries.length, 0);
  });
});

// --- root system section -----------------------------------------------------
test("a root adds the role body to a system section", () => {
  withEnvVars(
    { DECCY_ROLE: "deccy-plan", DECCY_ROLE_FILE: ROLE_FILE, DECCY_BUNDLE: undefined },
    () => {
      const { pi, handlers } = makePi();
      deccyRole(pi);
      const ctx = makeCtx("root-section-1");
      start(handlers, "startup", ctx);
      const { event, result } = beforeStart(handlers, ctx);
      assert.equal(result, undefined);
      assert.equal(
        event.systemPromptOptions.sections.deccy_role,
        "Role: deccy-plan\n\nYou are the test planner.",
      );
    },
  );
});

test("the section is re-added on every root run", () => {
  withEnvVars(
    { DECCY_ROLE: "deccy-plan", DECCY_ROLE_FILE: ROLE_FILE, DECCY_BUNDLE: undefined },
    () => {
      const { pi, handlers } = makePi();
      deccyRole(pi);
      const ctx = makeCtx("root-section-2");
      start(handlers, "startup", ctx);
      const first = beforeStart(handlers, ctx);
      const second = beforeStart(handlers, ctx);
      assert.equal(
        first.event.systemPromptOptions.sections.deccy_role,
        "Role: deccy-plan\n\nYou are the test planner.",
      );
      assert.equal(
        second.event.systemPromptOptions.sections.deccy_role,
        "Role: deccy-plan\n\nYou are the test planner.",
      );
    },
  );
});

test("a fork of the root gets the section", () => {
  withEnvVars(
    { DECCY_ROLE: "deccy-plan", DECCY_ROLE_FILE: ROLE_FILE, DECCY_BUNDLE: undefined },
    () => {
      const { pi, handlers } = makePi();
      deccyRole(pi);
      start(handlers, "startup", makeCtx("root-fork-1"));
      const fork = makeCtx("fork-1", "root-fork-1");
      start(handlers, "fork", fork);
      const { event } = beforeStart(handlers, fork);
      assert.equal(
        event.systemPromptOptions.sections.deccy_role,
        "Role: deccy-plan\n\nYou are the test planner.",
      );
    },
  );
});

test("an announced child gets no root section", () => {
  withEnvVars(
    { DECCY_ROLE: "deccy-orchestrator", DECCY_ROLE_FILE: ROLE_FILE, DECCY_BUNDLE: undefined },
    () => {
      const { pi, handlers, emit } = makePi();
      deccyRole(pi);
      emit(CHILD_CREATED, { sessionId: "child-section-1" });
      const child = makeCtx("child-section-1", "root-section-1");
      start(handlers, "startup", child);
      const { event, result } = beforeStart(handlers, child);
      assert.equal(event.systemPromptOptions.sections.deccy_role, undefined);
      assert.equal(result, undefined);
    },
  );
});

test("a child detected by its header gets no root section", () => {
  withEnvVars(
    { DECCY_ROLE: "deccy-orchestrator", DECCY_ROLE_FILE: ROLE_FILE, DECCY_BUNDLE: undefined },
    () => {
      const { pi, handlers } = makePi();
      deccyRole(pi);
      const child = makeCtx("child-header-1", "root-header-1");
      start(handlers, "startup", child);
      const { event } = beforeStart(handlers, child);
      assert.equal(event.systemPromptOptions.sections.deccy_role, undefined);
    },
  );
});

test("an invalid role adds no system section", () => {
  withEnvVars(
    { DECCY_ROLE: "deccy-bogus", DECCY_ROLE_FILE: ROLE_FILE, DECCY_BUNDLE: undefined },
    () => {
      const { pi, handlers } = makePi();
      deccyRole(pi);
      const ctx = makeCtx("root-invalid-section");
      start(handlers, "startup", ctx);
      const { event } = beforeStart(handlers, ctx);
      assert.equal(event.systemPromptOptions.sections.deccy_role, undefined);
    },
  );
});

test("no role file leaves the system prompt untouched", () => {
  withEnvVars(
    { DECCY_ROLE: "deccy-plan", DECCY_ROLE_FILE: undefined, DECCY_BUNDLE: undefined },
    () => {
      const { pi, handlers } = makePi();
      deccyRole(pi);
      const ctx = makeCtx("root-no-file");
      start(handlers, "startup", ctx);
      const { event, result } = beforeStart(handlers, ctx);
      assert.equal(event.systemPromptOptions.sections.deccy_role, undefined);
      assert.equal(result, undefined);
    },
  );
});

test("without mutable sections the body is appended to the prompt", () => {
  withEnvVars(
    { DECCY_ROLE: "deccy-plan", DECCY_ROLE_FILE: ROLE_FILE, DECCY_BUNDLE: undefined },
    () => {
      const { pi, handlers } = makePi();
      deccyRole(pi);
      const ctx = makeCtx("root-fallback-section");
      start(handlers, "startup", ctx);
      const { event, result } = beforeStart(handlers, ctx, null);
      assert.equal(event.systemPromptOptions, undefined);
      assert.match(result.systemPrompt, /^BASE PROMPT\n\n<deccy_role>/);
      assert.match(result.systemPrompt, /You are the test planner\./);
    },
  );
});

// --- child detection ---------------------------------------------------------
test("an announced child does not append active_agent", () => {
  withEnv("deccy-orchestrator", () => {
    const { pi, handlers, entries, emit } = makePi();
    deccyRole(pi);
    emit(CHILD_CREATED, { sessionId: "child-1", parentSessionId: "root-1" });
    start(handlers, "startup", CHILD);
    assert.equal(entries.length, 0);
  });
});

test("a child is detected by its header parent even without the event", () => {
  withEnv("deccy-orchestrator", () => {
    const { pi, handlers, entries } = makePi();
    deccyRole(pi);
    start(handlers, "startup", CHILD);
    assert.equal(entries.length, 0);
  });
});

test("a fork of the root stays a root", () => {
  withEnv("deccy-orchestrator", () => {
    const { pi, handlers, entries } = makePi();
    deccyRole(pi);
    start(handlers, "startup", ROOT);
    start(handlers, "fork", makeCtx("fork-1", "root-1"));
    assert.equal(entries.length, 2);
  });
});

test("disposing a child does not throw", () => {
  withEnv("deccy-orchestrator", () => {
    const { pi, handlers, entries, emit } = makePi();
    deccyRole(pi);
    emit(CHILD_CREATED, { sessionId: "child-1" });
    emit(CHILD_DISPOSED, { sessionId: "child-1" });
    start(handlers, "startup", CHILD);
    assert.equal(entries.length, 0);
  });
});

// --- `subagent` gate ---------------------------------------------------------
const allowed = ["deccy-plan", "deccy-gate-author", "deccy-drafter", "deccy-judge"];

test("the orchestrator may spawn each allowed role", () => {
  withEnv("deccy-orchestrator", () => {
    const { pi, handlers } = makePi();
    deccyRole(pi);
    start(handlers, "startup", ROOT);
    for (const subagent_type of allowed) {
      assert.equal(spawn(handlers, { subagent_type }, ROOT), undefined, subagent_type);
    }
  });
});

test("allowed names are case-insensitive and trimmed", () => {
  withEnv("deccy-orchestrator", () => {
    const { pi, handlers } = makePi();
    deccyRole(pi);
    start(handlers, "startup", ROOT);
    assert.equal(spawn(handlers, { subagent_type: "  DECCY-DRAFTER  " }, ROOT), undefined);
  });
});

test("the orchestrator may not spawn built-ins, itself or unknowns", () => {
  withEnv("deccy-orchestrator", () => {
    const { pi, handlers } = makePi();
    deccyRole(pi);
    start(handlers, "startup", ROOT);
    for (const subagent_type of [
      "general-purpose",
      "Explore",
      "Plan",
      "totally-unknown-xyz",
      "deccy-orchestrator",
    ]) {
      const result = spawn(handlers, { subagent_type }, ROOT);
      assert.equal(result?.block, true, subagent_type);
      assert.match(result.reason, /not allowed/, subagent_type);
    }
  });
});

test("a missing or empty subagent_type fails closed", () => {
  withEnv("deccy-orchestrator", () => {
    const { pi, handlers } = makePi();
    deccyRole(pi);
    start(handlers, "startup", ROOT);
    for (const input of [{}, { subagent_type: "" }, { subagent_type: "   " }, { subagent_type: 42 }]) {
      const result = spawn(handlers, input, ROOT);
      assert.equal(result?.block, true, JSON.stringify(input));
      assert.match(result.reason, /requires an explicit subagent_type/);
    }
  });
});

test("the legacy agent field is gated too", () => {
  withEnv("deccy-orchestrator", () => {
    const { pi, handlers } = makePi();
    deccyRole(pi);
    start(handlers, "startup", ROOT);
    assert.equal(spawn(handlers, { agent: "deccy-judge" }, ROOT), undefined);
    assert.equal(spawn(handlers, { agent: "general-purpose" }, ROOT)?.block, true);
  });
});

test("non-orchestrator roots may not spawn", () => {
  for (const role of ["deccy-plan", "plan"]) {
    withEnv(role, () => {
      const { pi, handlers } = makePi();
      deccyRole(pi);
      start(handlers, "startup", ROOT);
      const result = spawn(handlers, { subagent_type: "deccy-drafter" }, ROOT);
      assert.equal(result?.block, true, role);
      assert.match(result.reason, /only deccy-orchestrator/);
    });
  }
});

test("a child may never spawn, even with the orchestrator environment", () => {
  withEnv("deccy-orchestrator", () => {
    const { pi, handlers, emit } = makePi();
    deccyRole(pi);
    emit(CHILD_CREATED, { sessionId: "child-1" });
    const result = spawn(handlers, { subagent_type: "deccy-drafter" }, CHILD);
    assert.equal(result?.block, true);
    assert.match(result.reason, /may not spawn another subagent/);
  });
});

test("an invalid DECCY_ROLE fails the spawn gate closed", () => {
  withEnv("deccy-bogus", () => {
    const { pi, handlers } = makePi();
    deccyRole(pi);
    const result = spawn(handlers, { subagent_type: "deccy-drafter" }, ROOT);
    assert.equal(result?.block, true);
    assert.match(result.reason, /not a deccy root role/);
  });
});

test("no DECCY_ROLE leaves a plain pi session unguarded", () => {
  withEnv(undefined, () => {
    const { pi, handlers } = makePi();
    deccyRole(pi);
    assert.equal(spawn(handlers, { subagent_type: "general-purpose" }, ROOT), undefined);
  });
});

test("non-subagent tools pass through untouched", () => {
  withEnv("deccy-plan", () => {
    const { pi, handlers } = makePi();
    deccyRole(pi);
    assert.equal(
      handlers.get("tool_call")(
        { type: "tool_call", toolName: "read", toolCallId: "1", input: { path: "README.md" } },
        ROOT,
      ),
      undefined,
    );
  });
});

console.log(`\n${passed} checks passed`);
