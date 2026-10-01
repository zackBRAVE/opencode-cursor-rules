import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pluginDefault, { CursorRulesPlugin } from "../index";
import type { V2Context, V2Registration, V2SessionContextEvent } from "../src/v2";

/**
 * Build a mock v2 context that records registrations and lets tests fire
 * the captured callbacks manually.
 */
function createMockContext() {
  const contextHooks: Array<(event: V2SessionContextEvent) => Promise<void>> = [];
  const toolBeforeHooks: Array<
    (event: { tool: string; sessionID: string; id: string; input: unknown }) => Promise<void>
  > = [];
  const tools: Array<Record<string, unknown>> = [];
  const commands: Map<string, Record<string, unknown>> = new Map();
  const reg = (): V2Registration => ({ dispose: async () => {} });
  const promptCalls: Array<Record<string, unknown>> = [];

  const ctx = {
    app: { name: "opencode", version: "test" },
    options: {},
    tool: {
      transform: async (cb: (draft: { add: (t: Record<string, unknown>) => void }) => void) => {
        cb({ add: (t) => tools.push(t) });
        return reg();
      },
      hook: async (name: string, cb: (event: never) => Promise<void>) => {
        if (name === "execute.before") toolBeforeHooks.push(cb as never);
        return reg();
      },
    },
    command: {
      transform: async (
        cb: (draft: {
          add: (c: Record<string, unknown>) => void;
          list: () => Array<Record<string, unknown>>;
          get: (n: string) => Record<string, unknown> | undefined;
          update: (n: string, fn: (c: Record<string, unknown>) => void) => void;
          remove: (n: string) => void;
        }) => void,
      ) => {
        cb({
          add: (c) => commands.set(String(c.name), c),
          list: () => [...commands.values()],
          get: (n) => commands.get(n),
          update: (n, fn) => {
            const existing = commands.get(n) ?? {};
            fn(existing);
            commands.set(n, existing);
          },
          remove: (n) => commands.delete(n),
        });
        return reg();
      },
      list: async () => [...commands.values()],
    },
    session: {
      hook: async (name: string, cb: (event: V2SessionContextEvent) => Promise<void>) => {
        if (name === "context") contextHooks.push(cb);
        return reg();
      },
      prompt: async (input: Record<string, unknown>) => {
        promptCalls.push(input);
        return {};
      },
    },
    event: {
      subscribe: async function* () {},
    },
  } as unknown as V2Context;

  return { ctx, contextHooks, toolBeforeHooks, tools, commands, promptCalls };
}

function buildContextEvent(sessionID: string): V2SessionContextEvent {
  return {
    sessionID,
    agent: "build",
    model: {},
    system: [{ type: "text", text: "You are a coder." }],
    messages: [
      {
        id: "msg-1",
        role: "user",
        content: [{ type: "text", text: "hello world" }],
      },
    ],
    tools: {},
  };
}

describe("v2 plugin export", () => {
  test("default export is a v2 plugin object with id/server/setup", () => {
    expect(typeof pluginDefault).toBe("object");
    expect(pluginDefault).not.toBeNull();
    const p = pluginDefault as { id: string; server: unknown; setup: unknown };
    expect(p.id).toBe("opencode-cursor-rules");
    expect(typeof p.server).toBe("function");
    expect(typeof p.setup).toBe("function");
  });

  test("named v1 factory export is still a function", () => {
    expect(typeof CursorRulesPlugin).toBe("function");
  });

  test("setup no-ops silently on v1-style context (no tool/session surfaces)", async () => {
    const setup = (pluginDefault as { setup: (ctx: unknown) => Promise<() => Promise<void>> })
      .setup;
    const v1StyleCtx = {
      options: {},
      agent: { transform: async () => ({ dispose: async () => {} }), reload: async () => {} },
      command: { transform: async () => ({ dispose: async () => {} }), reload: async () => {} },
      catalog: { transform: async () => ({ dispose: async () => {} }), reload: async () => {} },
    };
    const cleanup = await setup(v1StyleCtx);
    expect(typeof cleanup).toBe("function");
    await cleanup();
  });

  test("setup no-ops safely with undefined context", async () => {
    const setup = (pluginDefault as { setup: (ctx: unknown) => Promise<() => Promise<void>> })
      .setup;
    const cleanup = await setup(undefined);
    expect(typeof cleanup).toBe("function");
    await cleanup();
  });
});

describe("v2 setup", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cursor-rules-v2-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);

    // Default gating: nothing loads before an explicit init
    delete process.env.LOAD_ALWAYS_APPLY_RULES_ON_STARTUP;
    delete process.env.LOAD_MENTION_RULES_WITHOUT_EXPLICIT_INIT;

    // Project rule: always applied
    mkdirSync(join(tempDir, ".opencode", "rules"), { recursive: true });
    writeFileSync(
      join(tempDir, ".opencode", "rules", "v2-always.mdc"),
      '---\ndescription: "v2 test rule"\nalwaysApply: true\n---\n\nV2 always rule content.',
    );
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.LOAD_ALWAYS_APPLY_RULES_ON_STARTUP;
    delete process.env.LOAD_MENTION_RULES_WITHOUT_EXPLICIT_INIT;
  });

  test("setup registers commands, tools, and session context hook", async () => {
    const mock = createMockContext();
    const setup = (pluginDefault as { setup: (ctx: V2Context) => Promise<() => Promise<void>> })
      .setup;
    const cleanup = await setup(mock.ctx);

    expect(mock.commands.has("list-rules")).toBe(true);
    expect(mock.commands.has("create-user-rule")).toBe(true);
    expect(mock.commands.has("create-project-rule")).toBe(true);
    expect(mock.commands.has("use-cursor-rule")).toBe(true);
    for (const command of mock.commands.values()) {
      expect(command.name).toBeDefined();
      // v2 commands carry execute() (or a template on legacy update() hosts)
      expect(typeof command.execute === "function" || typeof command.template === "string").toBe(
        true,
      );
    }

    const toolNames = mock.tools.map((t) => t.name);
    expect(toolNames).toContain("list_rules");
    expect(toolNames).toContain("create_user_rule");
    expect(toolNames).toContain("create_project_rule");
    for (const t of mock.tools) {
      expect(t.input).toBeDefined();
      expect(typeof t.execute).toBe("function");
    }

    expect(mock.contextHooks.length).toBe(1);
    expect(mock.toolBeforeHooks.length).toBe(1);

    await cleanup();
  });

  test("session context hook gates always-apply rule before explicit init", async () => {
    const mock = createMockContext();
    const setup = (pluginDefault as { setup: (ctx: V2Context) => Promise<() => Promise<void>> })
      .setup;
    const cleanup = await setup(mock.ctx);

    const event = buildContextEvent("ses-v2-gated");
    const contextHook = mock.contextHooks[0];
    if (!contextHook) throw new Error("context hook not registered");
    await contextHook(event);

    // Default flags (0/0): nothing is injected before an explicit init
    expect(event.system.length).toBe(1);

    await cleanup();
  });

  test("LOAD_ALWAYS_APPLY_RULES_ON_STARTUP=1 injects always rule without init", async () => {
    process.env.LOAD_ALWAYS_APPLY_RULES_ON_STARTUP = "1";
    const mock = createMockContext();
    const setup = (pluginDefault as { setup: (ctx: V2Context) => Promise<() => Promise<void>> })
      .setup;
    const cleanup = await setup(mock.ctx);

    const event = buildContextEvent("ses-v2-always");
    const contextHook = mock.contextHooks[0];
    if (!contextHook) throw new Error("context hook not registered");
    await contextHook(event);

    expect(event.system.length).toBe(2);
    expect(event.system[1]?.text).toContain("V2 always rule content.");

    await cleanup();
  });

  test("list_rules tool call is an explicit init and unlocks injection", async () => {
    const mock = createMockContext();
    const setup = (pluginDefault as { setup: (ctx: V2Context) => Promise<() => Promise<void>> })
      .setup;
    const cleanup = await setup(mock.ctx);

    const listTool = mock.tools.find((t) => t.name === "list_rules") as unknown as {
      execute: (input: unknown, ctx: unknown) => Promise<{ content: string }>;
    };
    const result = await listTool.execute({}, { sessionID: "ses-v2-init" });
    expect(result.content).toContain("v2-always");

    const event = buildContextEvent("ses-v2-init");
    const contextHook = mock.contextHooks[0];
    if (!contextHook) throw new Error("context hook not registered");
    await contextHook(event);

    expect(event.system.length).toBe(2);
    expect(event.system[1]?.text).toContain("V2 always rule content.");

    await cleanup();
  });

  test("use-cursor-rule command submits its template as a session prompt", async () => {
    const mock = createMockContext();
    const setup = (pluginDefault as { setup: (ctx: V2Context) => Promise<() => Promise<void>> })
      .setup;
    const cleanup = await setup(mock.ctx);

    const command = mock.commands.get("use-cursor-rule") as unknown as {
      execute: (invocation: {
        sessionID: string;
        prompt?: Record<string, unknown>;
        delivery?: string;
      }) => Promise<void>;
    };
    expect(typeof command.execute).toBe("function");
    await command.execute({
      sessionID: "ses-v2-cmd",
      prompt: { text: "ignored" },
      delivery: "steer",
    });

    expect(mock.promptCalls.length).toBe(1);
    expect(mock.promptCalls[0]?.sessionID).toBe("ses-v2-cmd");
    expect(String(mock.promptCalls[0]?.text)).toContain("list_rules");
    expect(mock.promptCalls[0]?.delivery).toBe("steer");

    await cleanup();
  });

  test("tool execute.before hook tracks file paths for glob rules", async () => {
    // Glob rules are "mention" class: allow them without init for this test
    process.env.LOAD_MENTION_RULES_WITHOUT_EXPLICIT_INIT = "1";
    const mock = createMockContext();
    const setup = (pluginDefault as { setup: (ctx: V2Context) => Promise<() => Promise<void>> })
      .setup;
    const cleanup = await setup(mock.ctx);

    // Glob-based project rule
    writeFileSync(
      join(tempDir, ".opencode", "rules", "v2-glob.mdc"),
      '---\ndescription: "v2 glob rule"\nglobs: "src/**/*.ts"\n---\n\nV2 glob rule content.',
    );

    const beforeHook = mock.toolBeforeHooks[0];
    if (!beforeHook) throw new Error("execute.before hook not registered");
    await beforeHook({
      tool: "edit",
      sessionID: "ses-v2-test",
      id: "call-1",
      input: { filePath: join(tempDir, "src", "main.ts") },
    });

    const event: V2SessionContextEvent = {
      sessionID: "ses-v2-test",
      agent: "build",
      model: {},
      system: [],
      messages: [],
      tools: {},
    };
    const contextHook = mock.contextHooks[0];
    if (!contextHook) throw new Error("context hook not registered");
    await contextHook(event);

    const combined = event.system.map((s) => s.text).join("\n");
    expect(combined).toContain("v2-glob");

    await cleanup();
  });

  test("registered list_rules tool executes and returns rule list", async () => {
    const mock = createMockContext();
    const setup = (pluginDefault as { setup: (ctx: V2Context) => Promise<() => Promise<void>> })
      .setup;
    const cleanup = await setup(mock.ctx);

    const listTool = mock.tools.find((t) => t.name === "list_rules") as unknown as {
      execute: (input: unknown, ctx: unknown) => Promise<{ content: string }>;
    };
    const result = await listTool.execute({}, { sessionID: "ses-v2-test" });
    expect(result.content).toContain("v2-always");

    await cleanup();
  });
});
