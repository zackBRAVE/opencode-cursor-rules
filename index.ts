import type { Plugin } from "@opencode-ai/plugin";
import { join } from "path";
import { homedir } from "os";
import { RuleLoader } from "./src/loader";
import { selectRules, formatSystemPromptSection } from "./src/matcher";
import type { SessionState } from "./src/types";

const PREFIX = "[cursor-rules]";
const DEBUG = process.env.OPENCODE_RULES_DEBUG === "true";

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
const CursorRulesPlugin: Plugin = async ({ directory, worktree }) => {
  const loader = new RuleLoader();
  const sessions = new Map<string, SessionState>();

  // Resolve paths
  const projectRoot = worktree || directory;
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");

  const userRulesDir = join(configHome, "opencode", "rules");
  const projectRulesDir = join(projectRoot, ".opencode", "rules");
  const legacyFilePath = join(projectRoot, ".cursorrules");

  // Log startup info
  if (DEBUG) {
    console.log(`${PREFIX} initializing...`);
    console.log(`${PREFIX}   project rules: ${projectRulesDir}`);
    console.log(`${PREFIX}   user rules:    ${userRulesDir}`);
    console.log(`${PREFIX}   legacy file:   ${legacyFilePath}`);
  }

  // Pre-warm cache (non-blocking, errors caught internally)
  loader
    .loadAll(userRulesDir, projectRulesDir, legacyFilePath)
    .then((rules) => {
      if (!DEBUG) return;

      if (rules.length > 0) {
        console.log(`${PREFIX} loaded ${rules.length} rule(s):`);
        for (const rule of rules) {
          const mode = rule.frontmatter.alwaysApply
            ? "always"
            : rule.frontmatter.globs.length > 0
            ? "glob"
            : rule.frontmatter.description
            ? "agent"
            : "manual";
          console.log(`${PREFIX}   - ${rule.name} [${mode}] (${rule.source})`);
        }
      } else {
        console.log(`${PREFIX} no rules found in any directory`);
      }
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
            const rel = val.startsWith(projectRoot)
              ? val.slice(projectRoot.length + 1)
              : val;
            session.filePaths.add(rel);
          }
        }

        // Handle glob/grep patterns (extract directory context)
        for (const key of ["pattern", "glob", "directory", "dir", "cwd"]) {
          const val = args[key];
          if (typeof val === "string" && val.length > 0) {
            const rel = val.startsWith(projectRoot)
              ? val.slice(projectRoot.length + 1)
              : val;
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
      const rules = await loader.loadAll(
        userRulesDir,
        projectRulesDir,
        legacyFilePath
      );

      if (rules.length === 0) return;

      // Select which rules to inject/suggest/list
      const { injected, suggested, available } = selectRules(rules, session);

      if (
        injected.length === 0 &&
        suggested.length === 0 &&
        available.length === 0
      )
        return;

      // Format and append to system prompt
      const section = formatSystemPromptSection(injected, suggested, available);
      if (section.length > 0) {
        output.system.push(section);
      }
    },
  };
};

export default CursorRulesPlugin;
