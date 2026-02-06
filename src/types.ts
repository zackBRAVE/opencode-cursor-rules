/**
 * Parsed frontmatter from an MDC rule file.
 * Matches the Cursor MDC specification exactly.
 */
export interface RuleFrontmatter {
  /** Rule purpose; used for agent-requested selection */
  description?: string;
  /** File glob patterns for auto-attach */
  globs: string[];
  /** If true, always included in system prompt */
  alwaysApply: boolean;
}

/**
 * A fully parsed rule ready for matching and injection.
 */
export interface Rule {
  /** Rule name derived from filename (without .mdc extension) */
  name: string;
  /** Absolute path to the source file */
  sourcePath: string;
  /** "project" | "user" | "legacy" */
  source: RuleSource;
  /** Parsed frontmatter metadata */
  frontmatter: RuleFrontmatter;
  /** Markdown content after frontmatter */
  body: string;
}

export type RuleSource = "project" | "user" | "legacy";

/**
 * Determines how a rule gets applied based on its frontmatter.
 *
 * - always:   alwaysApply is true
 * - glob:     has globs, alwaysApply is false
 * - agent:    has description only, no globs, alwaysApply is false
 * - manual:   no description, no globs, alwaysApply is false
 */
export type RuleMode = "always" | "glob" | "agent" | "manual";

/**
 * Per-session state tracking for rule matching context.
 */
export interface SessionState {
  /** Set of repo-relative file paths seen in tool calls */
  filePaths: Set<string>;
  /** Latest user message text (for @-mention extraction) */
  lastUserMessage: string;
}

/**
 * Result from the matcher: a rule plus why it was selected.
 */
export interface MatchedRule {
  rule: Rule;
  reason: string;
}

/**
 * Cache entry for a loaded rule.
 */
export interface CacheEntry {
  rule: Rule;
  mtimeMs: number;
}
