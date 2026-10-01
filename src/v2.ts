/**
 * OpenCode v2 plugin adapter.
 *
 * v2 loads plugins as an object export (`{ id, server, setup }`) and calls
 * `setup(ctx)` with a registration context. This module wraps the existing
 * v1 factory (reusing ALL rule loading/selection logic) and bridges the
 * returned v1 hooks into v2 registrations:
 *
 * - `experimental.chat.system.transform` + `chat.message` -> session "context" hook
 * - `tool.execute.before` -> tool "execute.before" hook
 * - `tool` registrations -> tool transform draft
 * - `config` command registration -> command transform draft
 *
 * The v2 plugin context surface is defined locally (the v2 plugin package is
 * not a build-time dependency; the v1 host must load this module without it).
 */
import type { Hooks, Plugin } from "@opencode-ai/plugin";

const LOG_PREFIX = "[opencode-cursor-rules][v2]";

function log(message: string, extra?: unknown) {
  if (process.env.CURSOR_RULES_DEBUG !== "1") return;
  if (extra !== undefined) console.error(LOG_PREFIX, message, extra);
  else console.error(LOG_PREFIX, message);
}

export interface V2Registration {
  dispose(): Promise<void> | void;
}

export interface V2SessionContextEvent {
  readonly sessionID: string;
  readonly agent: string;
  readonly model: Record<string, unknown>;
  system: Array<{ type: "text"; text: string }>;
  messages: Array<{
    id?: string;
    role: string;
    content: Array<Record<string, unknown>>;
  }>;
  tools: Record<string, unknown>;
}

export interface V2ToolBeforeEvent {
  readonly tool: string;
  readonly sessionID: string;
  readonly agent: string;
  readonly messageID: string;
  readonly id: string;
  input: unknown;
}

export interface V2ToolDraft {
  add(tool: Record<string, unknown>): void;
}

export interface V2CommandDraft {
  add(command: Record<string, unknown>): void;
  list(): Array<Record<string, unknown>>;
  get(name: string): Record<string, unknown> | undefined;
  update(name: string, update: (command: Record<string, unknown>) => void): void;
  remove(name: string): void;
}

export interface V2Context {
  readonly app: { readonly name: string; readonly version: string };
  readonly options: Record<string, unknown>;
  readonly location?: {
    readonly directory: string;
    readonly workspaceID?: string;
    readonly project?: {
      readonly id: string;
      readonly directory: string;
      readonly canonical: string;
    };
  };
  tool: {
    transform(cb: (draft: V2ToolDraft) => void): Promise<V2Registration>;
    hook(
      name: "execute.before" | "execute.after",
      cb: (event: V2ToolBeforeEvent) => Promise<void>,
    ): Promise<V2Registration>;
  };
  command: {
    transform(cb: (draft: V2CommandDraft) => void): Promise<V2Registration>;
    list(): Promise<unknown>;
  };
  session: {
    hook(
      name: "context",
      cb: (event: V2SessionContextEvent) => Promise<void>,
    ): Promise<V2Registration>;
    prompt(input: Record<string, unknown>): Promise<unknown>;
  };
  event: { subscribe(): AsyncIterable<Record<string, unknown>> };
}

export type V2Cleanup = () => Promise<void> | void;

/**
 * Minimal v1 PluginInput shim so the v1 factory can run under v2.
 * Only the surface the cursor-rules factory touches is provided.
 */
function buildPluginInput(directory: string) {
  const client = {
    app: {
      log: async (args: unknown) => {
        const body =
          (args as { body?: Record<string, unknown> })?.body ?? (args as Record<string, unknown>);
        const level = (body as { level?: string })?.level ?? "info";
        const message = (body as { message?: string })?.message ?? "";
        log(`host-log ${level}: ${String(message)}`);
      },
    },
  };
  return {
    client,
    project: { id: "global", directory },
    directory,
    worktree: directory,
    experimental_workspace: { register() {} },
    serverUrl: new URL("http://localhost:4096"),
    $: undefined,
  } as unknown as Parameters<Plugin>[0];
}

/** Explicit input schemas for the registered tools (no runtime zod dependency). */
const TOOL_INPUT_SCHEMAS: Record<string, Record<string, unknown>> = {
  create_user_rule: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Rule name (will be used as filename, e.g., 'typescript-standards')",
      },
      description: { type: "string", description: "Brief description of what the rule does" },
      content: { type: "string", description: "The rule content/instructions in Markdown" },
      globs: {
        type: "array",
        items: { type: "string", description: "Glob pattern (e.g., '*.ts', 'src/**/*.tsx')" },
        description: "File glob patterns for auto-attach mode",
      },
      alwaysApply: { type: "boolean", description: "Whether this rule should always be applied" },
    },
    required: ["name", "description", "content"],
  },
  create_project_rule: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Rule name (will be used as filename, e.g., 'api-conventions')",
      },
      description: { type: "string", description: "Brief description of what the rule does" },
      content: { type: "string", description: "The rule content/instructions in Markdown" },
      globs: {
        type: "array",
        items: { type: "string", description: "Glob pattern (e.g., '*.ts', 'src/**/*.tsx')" },
        description: "File glob patterns for auto-attach mode",
      },
      alwaysApply: { type: "boolean", description: "Whether this rule should always be applied" },
    },
    required: ["name", "description", "content"],
  },
  list_rules: { type: "object", properties: {} },
};

/**
 * Adapt a v1 tool definition ({description, execute}) into a v2 tool,
 * binding the explicit input schema and wrapping execute results.
 */
function adaptTool(
  name: string,
  v1Tool: { description?: string; execute?: (args: unknown, ctx: unknown) => Promise<unknown> },
  directory: string,
): Record<string, unknown> {
  const execute = v1Tool.execute;
  return {
    name,
    description: v1Tool.description ?? `Tool ${name}`,
    input: TOOL_INPUT_SCHEMAS[name] ?? { type: "object", properties: {} },
    execute: async (input: unknown, context: unknown) => {
      if (!execute) return { output: {} };
      const ctx = context as { sessionID?: string; messageID?: string; agent?: string };
      const v1Ctx = {
        sessionID: ctx?.sessionID ?? "",
        messageID: ctx?.messageID ?? "",
        agent: ctx?.agent ?? "orchestrator",
        directory,
        worktree: directory,
        abort: new AbortController().signal,
        metadata(_m: unknown) {},
        async ask(_m: unknown) {},
      };
      const result = await execute(input, v1Ctx);
      if (typeof result === "string") return { content: result };
      if (result && typeof result === "object") {
        const r = result as { output?: unknown; metadata?: unknown; title?: string };
        return {
          content: typeof r.output === "string" ? r.output : "",
          metadata: {
            ...((r.metadata as Record<string, unknown>) ?? {}),
            ...(r.title ? { title: r.title } : {}),
          },
        };
      }
      return { content: String(result ?? "") };
    },
  };
}

/**
 * Create the `setup(ctx)` function v2 calls via the default export's `setup`.
 * Wraps the v1 factory and translates its hooks into v2 registrations.
 * Each bridge is independently try/catch-guarded so one failure cannot
 * block the others.
 */
export function createV2Setup(factory: Plugin): (ctx: V2Context) => Promise<V2Cleanup> {
  return async (ctx: V2Context) => {
    // Host shape detection: opencode v1 (>=1.18.13) also invokes `setup` on
    // v2-style object exports, but with a v1 registration context that has no
    // `tool`/`session` surfaces (agent/catalog/command/skill/... instead).
    // Under v1 the `server()` export already provides full functionality, so
    // the correct action here is a silent no-op.
    if (!ctx || typeof ctx !== "object") {
      return async () => {};
    }
    const hasV2ToolSurface = !!ctx.tool && typeof ctx.tool.transform === "function";
    const hasV2SessionSurface = !!ctx.session && typeof ctx.session.hook === "function";
    if (!hasV2ToolSurface || !hasV2SessionSurface) {
      return async () => {};
    }

    log("setup invoked", { app: ctx.app, cwd: process.cwd() });
    // Resolve the project root from the plugin instance's location. The shared
    // server process may be started from any directory (often $HOME), so
    // process.cwd() is not a reliable project root under v2.
    const project = ctx.location?.project;
    const directory =
      project?.canonical || project?.directory || ctx.location?.directory || process.cwd();
    log("project root resolved", { directory, location: ctx.location?.directory });

    const disposers: Array<() => Promise<void> | void> = [];

    let v1Hooks: Hooks;
    try {
      v1Hooks = await factory(buildPluginInput(directory));
    } catch (err) {
      log("FATAL: v1 factory init failed", String(err));
      return async () => {};
    }

    // Commands: run the v1 config hook against a synthetic config, then
    // apply the produced command entries to the v2 command draft.
    let synthCommands: Record<string, Record<string, unknown>> | undefined;
    try {
      const configFn = v1Hooks.config;
      if (configFn) {
        const synth: { command?: Record<string, Record<string, unknown>> } = {};
        await configFn(synth as never);
        if (synth.command) synthCommands = synth.command;
      }
    } catch (err) {
      log("config() hook failed", String(err));
    }
    if (synthCommands && Object.keys(synthCommands).length > 0) {
      try {
        const reg = await ctx.command.transform((draft) => {
          for (const [name, cmd] of Object.entries(synthCommands ?? {})) {
            try {
              // v2 commands need an execute() that submits the template as a
              // prompt; draft.update() only edits existing commands.
              const template = typeof cmd.template === "string" ? cmd.template : "";
              const definition = {
                name,
                description: typeof cmd.description === "string" ? cmd.description : name,
                execute: async (invocation: {
                  sessionID: string;
                  prompt?: Record<string, unknown>;
                  delivery?: string;
                }) => {
                  try {
                    await ctx.session.prompt({
                      ...(invocation.prompt ?? {}),
                      sessionID: invocation.sessionID,
                      text: template,
                      ...(invocation.delivery ? { delivery: invocation.delivery } : {}),
                    });
                  } catch (err) {
                    log("command execute failed", { name, err: String(err) });
                  }
                },
              };
              if (typeof draft.add === "function") {
                draft.add(definition);
              } else {
                // Legacy host without add(): fall back to update()
                draft.update(name, (c) => {
                  c.name = name;
                  if (typeof cmd.template === "string") c.template = cmd.template;
                  if (typeof cmd.description === "string") c.description = cmd.description;
                });
              }
            } catch (err) {
              log("command adapt failed", { name, err: String(err) });
            }
          }
        });
        disposers.push(() => reg.dispose());
        log("commands registered", { names: Object.keys(synthCommands ?? {}) });
      } catch (err) {
        log("command.transform failed", String(err));
      }
    }

    // Tools: adapt v1 tool registrations into the v2 tool draft.
    try {
      const tools = (v1Hooks.tool ?? {}) as Record<
        string,
        { description?: string; execute?: (args: unknown, ctx: unknown) => Promise<unknown> }
      >;
      const entries = Object.entries(tools);
      if (entries.length > 0) {
        const reg = await ctx.tool.transform((draft) => {
          for (const [name, def] of entries) {
            try {
              draft.add(adaptTool(name, def, directory));
            } catch (err) {
              log("tool adapt failed", { name, err: String(err) });
            }
          }
        });
        disposers.push(() => reg.dispose());
        log("tools registered", { count: entries.length });
      }
    } catch (err) {
      log("tool.transform failed", String(err));
    }

    // Session context: bridge @-mention capture (chat.message) and system
    // prompt injection (experimental.chat.system.transform).
    const systemTransform = v1Hooks["experimental.chat.system.transform"];
    const chatMessage = v1Hooks["chat.message"];
    if (systemTransform || chatMessage) {
      try {
        const reg = await ctx.session.hook("context", async (event) => {
          if (chatMessage) {
            // Feed the latest user message text into the v1 hook for
            // @rule-name mention detection.
            const lastUser = [...event.messages].reverse().find((m) => m.role === "user");
            if (lastUser && Array.isArray(lastUser.content)) {
              try {
                await chatMessage(
                  { sessionID: event.sessionID } as never,
                  { parts: lastUser.content } as never,
                );
              } catch (err) {
                log("chat.message bridge failed", String(err));
              }
            }
          }
          if (systemTransform && Array.isArray(event.system)) {
            try {
              const sysStrings = event.system.map((s) => s.text ?? "");
              await systemTransform(
                { sessionID: event.sessionID } as never,
                { system: sysStrings } as never,
              );
              event.system = sysStrings.map((text) => ({ type: "text" as const, text }));
            } catch (err) {
              log("system transform bridge failed", String(err));
            }
          }
        });
        disposers.push(() => reg.dispose());
        log("session context hook registered");
      } catch (err) {
        log("session.hook(context) failed", String(err));
      }
    }

    // Tool execute.before: track file paths for glob-based rule matching.
    const before = v1Hooks["tool.execute.before"];
    if (before) {
      try {
        const reg = await ctx.tool.hook("execute.before", async (event) => {
          try {
            const out = { args: event.input };
            await before(
              { tool: event.tool, sessionID: event.sessionID, callID: event.id } as never,
              out as never,
            );
            event.input = out.args;
          } catch (err) {
            log("tool.execute.before bridge failed", String(err));
          }
        });
        disposers.push(() => reg.dispose());
      } catch (err) {
        log("tool.hook(execute.before) failed", String(err));
      }
    }

    return async () => {
      for (const dispose of disposers) {
        try {
          await dispose();
        } catch {
          // ignore dispose errors
        }
      }
    };
  };
}
