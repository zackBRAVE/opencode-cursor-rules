import { homedir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { RuleLoader } from "./src/loader";
import { formatSystemPromptSection, selectRules } from "./src/matcher";
import { createProjectRule, createUserRule, listRules } from "./src/tools";
import type { SessionState } from "./src/types";

const SERVICE_NAME = "cursor-rules";

/**
 * OpenCode plugin that brings full Cursor rules (.mdc) support to OpenCode.
 *
 * Reads rules from:
 * - User level:    ~/.config/opencode/rules/
 * - Project level: <worktree>/.opencode/rules/
 * - Legacy:        <worktree>/.cursorrules
 *
 * Supports all four Cursor rule modes:
 * - Always apply (alwaysApply: true)
 * - Auto-attach via glob patterns
 * - Agent-requested via description
 * - Manual via @rule-name mention
 */
const CursorRulesPlugin: Plugin = async ({ directory, worktree, client }) => {
  const loader = new RuleLoader();
  const sessions = new Map<string, SessionState>();

  // Resolve paths
  const projectRoot = worktree || directory;
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");

  const userRulesDir = join(configHome, "opencode", "rules");
  const projectRulesDir = join(projectRoot, ".opencode", "rules");
  const legacyFilePath = join(projectRoot, ".cursorrules");

  // Log startup info
  await client.app.log({
    body: {
      service: SERVICE_NAME,
      level: "info",
      message: "Initializing cursor rules plugin",
      extra: {
        projectRulesDir,
        userRulesDir,
        legacyFilePath,
      },
    },
  });

  // Pre-warm cache (non-blocking, errors caught internally)
  loader
    .loadAll(userRulesDir, projectRulesDir, legacyFilePath)
    .then(async (rules) => {
      if (rules.length > 0) {
        await client.app.log({
          body: {
            service: SERVICE_NAME,
            level: "info",
            message: `Loaded ${rules.length} cursor rule(s)`,
            extra: {
              rules: rules.map((r) => ({
                name: r.name,
                source: r.source,
                mode: r.frontmatter.alwaysApply
                  ? "always"
                  : r.frontmatter.globs.length > 0
                    ? "glob"
                    : r.frontmatter.description
                      ? "agent"
                      : "manual",
              })),
            },
          },
        });
      } else {
        await client.app.log({
          body: {
            service: SERVICE_NAME,
            level: "debug",
            message: "No cursor rules found in any directory",
          },
        });
      }
    })
    .catch(async (error) => {
      await client.app.log({
        body: {
          service: SERVICE_NAME,
          level: "error",
          message: "Failed to load cursor rules during initialization",
          extra: {
            error: error instanceof Error ? error.message : String(error),
          },
        },
      });
    });

  /**
   * Get or create session state.
   */
  function getSession(sessionID: string | undefined): SessionState {
    const id = sessionID || "__default__";
    let state = sessions.get(id);
    if (!state) {
      state = { filePaths: new Set(), lastUserMessage: "" };
      sessions.set(id, state);

      // Cap sessions to prevent memory leak (LRU eviction)
      if (sessions.size > 100) {
        const firstKey = sessions.keys().next().value;
        if (firstKey) sessions.delete(firstKey);
      }
    }
    return state;
  }

  return {
    /**
     * Track files accessed by tool calls to enable glob-based rule matching.
     */
    "tool.execute.before": async (input, output) => {
      const session = getSession(input.sessionID);

      // Extract file paths from tool arguments
      const args = output.args;
      if (args && typeof args === "object") {
        // Common file path argument names across OpenCode tools
        for (const key of ["path", "file_path", "filePath", "file", "target"]) {
          const val = args[key];
          if (typeof val === "string" && val.length > 0) {
            // Normalize to relative path
            const rel = val.startsWith(projectRoot) ? val.slice(projectRoot.length + 1) : val;
            session.filePaths.add(rel);
          }
        }

        // Handle glob/grep patterns (extract directory context)
        for (const key of ["pattern", "glob", "directory", "dir", "cwd"]) {
          const val = args[key];
          if (typeof val === "string" && val.length > 0) {
            const rel = val.startsWith(projectRoot) ? val.slice(projectRoot.length + 1) : val;
            session.filePaths.add(rel);
          }
        }
      }
    },

    /**
     * Capture user messages for @rule-name mention detection.
     */
    "chat.message": async (input, output) => {
      const session = getSession(input.sessionID);

      // Extract text from message parts
      const textParts: string[] = [];
      for (const part of output.parts) {
        if ("text" in part && typeof part.text === "string") {
          textParts.push(part.text);
        }
      }
      session.lastUserMessage = textParts.join("\n");
    },

    /**
     * Inject matching rules into the system prompt.
     * This is the core hook that makes rules work.
     */
    "experimental.chat.system.transform": async (input, output) => {
      const session = getSession(input.sessionID);

      // Re-load rules (uses mtime cache, very fast on warm hits)
      const rules = await loader.loadAll(userRulesDir, projectRulesDir, legacyFilePath);

      if (rules.length === 0) {
        await client.app.log({
          body: {
            service: SERVICE_NAME,
            level: "debug",
            message: "No rules loaded for system prompt injection",
          },
        });
        return;
      }

      // Select which rules to inject/suggest/list
      const { injected, suggested, available } = selectRules(rules, session);

      await client.app.log({
        body: {
          service: SERVICE_NAME,
          level: "debug",
          message: "Selected rules for system prompt",
          extra: {
            totalRules: rules.length,
            injected: injected.map((m) => m.rule.name),
            suggested: suggested.map((m) => m.rule.name),
            available: available.map((r) => r.name),
          },
        },
      });

      if (injected.length === 0 && suggested.length === 0 && available.length === 0) return;

      // Format and append to system prompt
      const section = formatSystemPromptSection(injected, suggested, available);
      if (section.length > 0) {
        output.system.push(section);
      }
    },

    /**
     * Register slash commands for rule management.
     */
    config: async (config) => {
      // Initialize command config if not exists
      config.command = config.command || {};

      // Command to create a user-level rule
      config.command["create-user-rule"] = {
        description: "Create a new user-level rule that applies globally",
        template: `Create a new user-level rule for OpenCode. Ask the user for:
1. Rule name (e.g., "typescript-standards", "bun-preference")
2. Brief description of what the rule does
3. Rule content (the actual instructions)
4. Whether it should always apply (optional, default: false)
5. File glob patterns if it should auto-attach to specific files (optional)

Use the create_user_rule tool to create the rule file at the user level (~/.config/opencode/rules/).`,
      };

      // Command to create a project-level rule
      config.command["create-project-rule"] = {
        description: "Create a new project-level rule for the current workspace",
        template: `Create a new project-level rule for OpenCode. Ask the user for:
1. Rule name (e.g., "api-conventions", "component-patterns")
2. Brief description of what the rule does
3. Rule content (the actual instructions)
4. Whether it should always apply (optional, default: false)
5. File glob patterns if it should auto-attach to specific files (optional)

Use the create_project_rule tool to create the rule file at the project level (.opencode/rules/).`,
      };

      // Command to list all loaded rules
      config.command["list-rules"] = {
        description: "List all currently loaded rules with their loading strategies",
        template: `Show all loaded cursor rules for the current session, including:
- Rule name
- Source (user-level, project-level, or legacy .cursorrules)
- Loading mode (always, glob, agent-requested, manual)
- File patterns (for glob mode)
- Description

Use the list_rules tool to retrieve and display this information.`,
      };
    },

    /**
     * Register tools for rule management.
     */
    tool: {
      create_user_rule: tool({
        description: "Create a new user-level (global) rule for OpenCode",
        args: {
          name: tool.schema.string(
            "Rule name (will be used as filename, e.g., 'typescript-standards')",
          ),
          description: tool.schema.string("Brief description of what the rule does"),
          content: tool.schema.string("The rule content/instructions in Markdown"),
          globs: tool.schema.optional(
            tool.schema.array(
              tool.schema.string("Glob pattern (e.g., '*.ts', 'src/**/*.tsx')"),
              "File glob patterns for auto-attach mode",
            ),
          ),
          alwaysApply: tool.schema.optional(
            tool.schema.boolean("Whether this rule should always be applied"),
          ),
        },
        execute: async (args) => {
          await client.app.log({
            body: {
              service: SERVICE_NAME,
              level: "info",
              message: `Creating user-level rule: ${args.name}`,
              extra: {
                name: args.name,
                globs: args.globs,
                alwaysApply: args.alwaysApply,
              },
            },
          });

          const result = await createUserRule(
            args.name,
            args.description,
            args.content,
            args.globs,
            args.alwaysApply,
          );

          if (result.success && result.filePath) {
            await client.app.log({
              body: {
                service: SERVICE_NAME,
                level: "info",
                message: `Successfully created user-level rule: ${args.name}`,
                extra: { filePath: result.filePath },
              },
            });
            return `✅ Created user-level rule "${args.name}" at ${result.filePath}`;
          }

          await client.app.log({
            body: {
              service: SERVICE_NAME,
              level: "error",
              message: `Failed to create user-level rule: ${args.name}`,
              extra: { error: result.message },
            },
          });
          return `❌ Failed to create user rule: ${result.message}`;
        },
      }),

      create_project_rule: tool({
        description: "Create a new project-level rule for OpenCode",
        args: {
          name: tool.schema.string("Rule name (will be used as filename, e.g., 'api-conventions')"),
          description: tool.schema.string("Brief description of what the rule does"),
          content: tool.schema.string("The rule content/instructions in Markdown"),
          globs: tool.schema.optional(
            tool.schema.array(
              tool.schema.string("Glob pattern (e.g., '*.ts', 'src/**/*.tsx')"),
              "File glob patterns for auto-attach mode",
            ),
          ),
          alwaysApply: tool.schema.optional(
            tool.schema.boolean("Whether this rule should always be applied"),
          ),
        },
        execute: async (args) => {
          await client.app.log({
            body: {
              service: SERVICE_NAME,
              level: "info",
              message: `Creating project-level rule: ${args.name}`,
              extra: {
                name: args.name,
                globs: args.globs,
                alwaysApply: args.alwaysApply,
              },
            },
          });

          const result = await createProjectRule(
            args.name,
            args.description,
            args.content,
            args.globs,
            args.alwaysApply,
            projectRoot,
          );

          if (result.success && result.filePath) {
            await client.app.log({
              body: {
                service: SERVICE_NAME,
                level: "info",
                message: `Successfully created project-level rule: ${args.name}`,
                extra: { filePath: result.filePath },
              },
            });
            return `✅ Created project-level rule "${args.name}" at ${result.filePath}`;
          }

          await client.app.log({
            body: {
              service: SERVICE_NAME,
              level: "error",
              message: `Failed to create project-level rule: ${args.name}`,
              extra: { error: result.message },
            },
          });
          return `❌ Failed to create project rule: ${result.message}`;
        },
      }),

      list_rules: tool({
        description: "List all currently loaded cursor rules with their loading strategies",
        args: {},
        execute: async () => {
          await client.app.log({
            body: {
              service: SERVICE_NAME,
              level: "info",
              message: "Listing all cursor rules",
            },
          });

          const result = await listRules(userRulesDir, projectRulesDir, legacyFilePath, loader);

          if (!result.success || !result.rules) {
            await client.app.log({
              body: {
                service: SERVICE_NAME,
                level: "error",
                message: "Failed to list rules",
                extra: { error: result.message },
              },
            });
            return `❌ Failed to list rules: ${result.message}`;
          }

          await client.app.log({
            body: {
              service: SERVICE_NAME,
              level: "info",
              message: `Listed ${result.rules.length} cursor rule(s)`,
            },
          });

          // Format the rules into a readable output
          const lines: string[] = [];
          lines.push("# Loaded Cursor Rules\n");

          if (result.rules.length > 0) {
            // Group by source
            const userRules = result.rules.filter((r) => r.source === "user");
            const projectRules = result.rules.filter((r) => r.source === "project");
            const legacyRules = result.rules.filter((r) => r.source === "legacy");

            if (userRules.length > 0) {
              lines.push("## User-Level Rules (~/.config/opencode/rules/)\n");
              for (const rule of userRules) {
                lines.push(formatRuleEntry(rule));
              }
              lines.push("");
            }

            if (projectRules.length > 0) {
              lines.push("## Project-Level Rules (.opencode/rules/)\n");
              for (const rule of projectRules) {
                lines.push(formatRuleEntry(rule));
              }
              lines.push("");
            }

            if (legacyRules.length > 0) {
              lines.push("## Legacy Rules (.cursorrules)\n");
              for (const rule of legacyRules) {
                lines.push(formatRuleEntry(rule));
              }
              lines.push("");
            }

            lines.push(`\n**Total: ${result.rules.length} rule(s)**`);
          } else {
            lines.push("No rules loaded.");
            lines.push("\nCreate rules using:");
            lines.push("- `/create-user-rule` - for global rules");
            lines.push("- `/create-project-rule` - for project-specific rules");
          }

          return lines.join("\n");
        },
      }),
    },
  };
};

/**
 * Format a single rule entry for display.
 */
function formatRuleEntry(rule: {
  name: string;
  source: string;
  mode: string;
  description?: string;
  globs: string[];
  alwaysApply: boolean;
  filePath: string;
}): string {
  const parts: string[] = [];

  // Name and mode badge
  const modeBadge =
    rule.mode === "always"
      ? "🔴 always"
      : rule.mode === "glob"
        ? "🟡 glob"
        : rule.mode === "agent"
          ? "🔵 agent"
          : "⚪ manual";
  parts.push(`### ${rule.name} ${modeBadge}`);

  // Description
  if (rule.description) {
    parts.push(`> ${rule.description}`);
  }

  // Details
  const details: string[] = [];
  if (rule.globs.length > 0) {
    details.push(`**Globs:** ${rule.globs.join(", ")}`);
  }
  details.push(`**File:** \`${rule.filePath}\``);
  parts.push(details.join(" | "));

  return parts.join("\n");
}

export default CursorRulesPlugin;
