import picomatch from "picomatch";
import { basename } from "path";
import type { Rule, RuleMode, MatchedRule, SessionState } from "./types";

/**
 * Determine the application mode of a rule based on its frontmatter.
 */
export function getRuleMode(rule: Rule): RuleMode {
  if (rule.frontmatter.alwaysApply) return "always";
  if (rule.frontmatter.globs.length > 0) return "glob";
  if (rule.frontmatter.description) return "agent";
  return "manual";
}

/**
 * Select rules and categorize them for the system prompt.
 *
 * Returns three categories:
 * - `injected`:    Rules whose full body is injected (always-apply, @-mentioned)
 * - `suggested`:   Rules the agent should read (glob-matched — contextually relevant)
 * - `available`:   Rules the agent may read (description-only — agent decides relevance)
 */
export function selectRules(
  rules: Rule[],
  session: SessionState,
): { injected: MatchedRule[]; suggested: MatchedRule[]; available: Rule[] } {
  const injected: MatchedRule[] = [];
  const suggested: MatchedRule[] = [];
  const available: Rule[] = [];
  const seenNames = new Set<string>();

  // Extract @-mentioned rule names from user message
  const mentionedNames = extractMentionedRules(session.lastUserMessage);

  for (const rule of rules) {
    if (seenNames.has(rule.name)) continue;

    const isMentioned = mentionedNames.has(rule.name);
    const mode = getRuleMode(rule);

    // @-mention always injects full content, regardless of mode
    if (isMentioned) {
      injected.push({ rule, reason: `@mentioned by user` });
      seenNames.add(rule.name);
      continue;
    }

    switch (mode) {
      case "always":
        // Always-apply: inject full content unconditionally
        injected.push({ rule, reason: "alwaysApply: true" });
        seenNames.add(rule.name);
        break;

      case "glob": {
        // Glob-matched: suggest reading (contextually relevant but not forced)
        const matchedFile = matchGlobs(rule.frontmatter.globs, session.filePaths);
        if (matchedFile) {
          suggested.push({
            rule,
            reason: `glob match: ${rule.frontmatter.globs.join(", ")} → ${matchedFile}`,
          });
          seenNames.add(rule.name);
        }
        break;
      }

      case "agent":
        // Description-only: list as available for agent to decide
        available.push(rule);
        seenNames.add(rule.name);
        break;

      case "manual":
        // Only included via @-mention (handled above)
        break;
    }
  }

  return { injected, suggested, available };
}

/**
 * Test if any file in the session matches any of the rule's glob patterns.
 * Returns the first matching file path, or null.
 *
 * Tries two strategies:
 * 1. Full relative path match (for patterns like "src/components/**\/*.tsx")
 * 2. Basename-only match (for simple patterns like "*.ts")
 */
function matchGlobs(globs: string[], filePaths: Set<string>): string | null {
  if (globs.length === 0 || filePaths.size === 0) return null;

  // Compile two sets of matchers:
  // - Full path matchers (default picomatch behavior)
  // - Basename matchers (for simple extension patterns)
  const fullMatchers = globs.map((g) => picomatch(g, { dot: true }));
  const baseMatchers = globs.map((g) =>
    picomatch(g, { dot: true, basename: true })
  );

  for (const file of filePaths) {
    const base = basename(file);
    for (let i = 0; i < globs.length; i++) {
      // Match full relative path first, then try basename
      if (
        fullMatchers[i]!(file) ||
        baseMatchers[i]!(file) ||
        fullMatchers[i]!(base)
      ) {
        return file;
      }
    }
  }

  return null;
}

/**
 * Extract @rule-name mentions from user message text.
 * Matches patterns like @rule-name (word chars and hyphens).
 */
function extractMentionedRules(message: string): Set<string> {
  const names = new Set<string>();
  if (!message) return names;

  // Match @rule-name patterns (not email addresses)
  const re = /(?:^|\s)@([\w][\w-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(message)) !== null) {
    if (match[1]) {
      names.add(match[1]);
    }
  }

  return names;
}

/**
 * Format selected rules into a system prompt section.
 *
 * Three tiers:
 * 1. Injected rules: full content in the prompt (always-apply + @-mentioned)
 * 2. Suggested rules: file path + description, agent should read them (glob-matched)
 * 3. Available rules: file path + description, agent reads if relevant (description-only)
 */
export function formatSystemPromptSection(
  injected: MatchedRule[],
  suggested: MatchedRule[],
  available: Rule[],
): string {
  if (injected.length === 0 && suggested.length === 0 && available.length === 0) {
    return "";
  }

  const parts: string[] = [];

  parts.push("<rules>");
  parts.push(
    "The rules section contains instructions you should follow. Some rules are included in full below. Others are referenced by file path — use your file read tool to read them when relevant.",
  );
  parts.push("");

  // --- Tier 1: Injected rules (full content) ---
  // Group by source
  const userInjected = injected.filter((m) => m.rule.source === "user");
  const projectInjected = injected.filter(
    (m) => m.rule.source === "project" || m.rule.source === "legacy",
  );

  if (userInjected.length > 0) {
    parts.push(
      '<user_rules description="These are rules set by the user that you should follow if appropriate.">',
    );
    for (const { rule } of userInjected) {
      parts.push(`<user_rule>${rule.body.trim()}</user_rule>`);
    }
    parts.push("</user_rules>");
    parts.push("");
  }

  if (projectInjected.length > 0) {
    parts.push(
      '<project_rules description="These are rules specific to this project. Follow them when working in this codebase.">',
    );
    for (const { rule } of projectInjected) {
      const desc = rule.frontmatter.description
        ? ` description="${rule.frontmatter.description}"`
        : "";
      parts.push(`<project_rule name="${rule.name}"${desc}>`);
      parts.push(rule.body.trim());
      parts.push("</project_rule>");
    }
    parts.push("</project_rules>");
    parts.push("");
  }

  // --- Tier 2: Suggested rules (glob-matched, agent should read) ---
  if (suggested.length > 0) {
    parts.push(
      '<suggested_rules description="These rules matched files in the current context. Read them with your file read tool before proceeding.">',
    );
    for (const { rule, reason } of suggested) {
      const desc = rule.frontmatter.description
        ? ` — ${rule.frontmatter.description}`
        : "";
      parts.push(`- **${rule.name}**${desc}`);
      parts.push(`  Path: ${rule.sourcePath}`);
      parts.push(`  Matched because: ${reason}`);
    }
    parts.push("</suggested_rules>");
    parts.push("");
  }

  // --- Tier 3: Available rules (description-only, agent decides) ---
  if (available.length > 0) {
    parts.push(
      '<available_rules description="Additional rules that may be relevant. Read them with your file read tool if they seem useful for the current task.">',
    );
    for (const rule of available) {
      const desc = rule.frontmatter.description || rule.name;
      parts.push(`- **${rule.name}**: ${desc}`);
      parts.push(`  Path: ${rule.sourcePath}`);
    }
    parts.push("</available_rules>");
    parts.push("");
  }

  parts.push("</rules>");

  return parts.join("\n");
}
