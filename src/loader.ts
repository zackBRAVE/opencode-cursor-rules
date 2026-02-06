import { join, basename } from "path";
import { stat } from "fs/promises";
import { parseMdc } from "./parser";
import type { Rule, RuleSource, CacheEntry } from "./types";

/**
 * RuleLoader discovers and caches rules from disk.
 *
 * Uses mtime-based cache invalidation: on each load, files are stat'd
 * and only re-parsed if mtime has changed. No file watchers needed.
 */
export class RuleLoader {
  private cache = new Map<string, CacheEntry>();

  /**
   * Load all rules from both user-level and project-level directories.
   *
   * @param userRulesDir   Absolute path to user rules (e.g. ~/.config/opencode/rules)
   * @param projectRulesDir Absolute path to project rules (e.g. <worktree>/.opencode/rules)
   * @param legacyFilePath  Absolute path to legacy .cursorrules file (optional)
   * @returns Array of rules, project rules taking precedence over user rules
   */
  async loadAll(
    userRulesDir: string | null,
    projectRulesDir: string | null,
    legacyFilePath: string | null
  ): Promise<Rule[]> {
    const rulesByName = new Map<string, Rule>();

    // User rules loaded first (lower priority)
    if (userRulesDir) {
      const userRules = await this.loadFromDirectory(userRulesDir, "user");
      for (const rule of userRules) {
        rulesByName.set(rule.name, rule);
      }
    }

    // Project rules loaded second (higher priority, overrides user)
    if (projectRulesDir) {
      const projectRules = await this.loadFromDirectory(
        projectRulesDir,
        "project"
      );
      for (const rule of projectRules) {
        rulesByName.set(rule.name, rule);
      }
    }

    // Legacy .cursorrules (always-apply, won't override named rules)
    if (legacyFilePath) {
      const legacyRule = await this.loadLegacyFile(legacyFilePath);
      if (legacyRule && !rulesByName.has(legacyRule.name)) {
        rulesByName.set(legacyRule.name, legacyRule);
      }
    }

    return Array.from(rulesByName.values());
  }

  /**
   * Scan a directory for .mdc and .md rule files, parse them with caching.
   */
  private async loadFromDirectory(
    dir: string,
    source: RuleSource
  ): Promise<Rule[]> {
    const rules: Rule[] = [];

    let files: string[];
    try {
      files = await this.scanRuleFiles(dir);
    } catch {
      // Directory doesn't exist or isn't readable
      return rules;
    }

    for (const filePath of files) {
      const rule = await this.loadSingleFile(filePath, source);
      if (rule) {
        rules.push(rule);
      }
    }

    return rules;
  }

  /**
   * Scan directory for .mdc and .md files using Bun.Glob.
   */
  private async scanRuleFiles(dir: string): Promise<string[]> {
    // Check directory exists
    try {
      const s = await stat(dir);
      if (!s.isDirectory()) return [];
    } catch {
      return [];
    }

    const paths: string[] = [];
    const glob = new Bun.Glob("*.{mdc,md}");

    for await (const file of glob.scan({
      cwd: dir,
      absolute: true,
      followSymlinks: true,
    })) {
      paths.push(file);
    }

    return paths;
  }

  /**
   * Load a single rule file with mtime-based caching.
   */
  private async loadSingleFile(
    filePath: string,
    source: RuleSource
  ): Promise<Rule | null> {
    let mtimeMs: number;
    try {
      const s = await stat(filePath);
      mtimeMs = s.mtimeMs;
    } catch {
      // File doesn't exist or broken symlink
      this.cache.delete(filePath);
      return null;
    }

    // Check cache
    const cached = this.cache.get(filePath);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.rule;
    }

    // Parse file
    let raw: string;
    try {
      raw = await Bun.file(filePath).text();
    } catch {
      this.cache.delete(filePath);
      return null;
    }

    if (raw.length === 0) {
      this.cache.delete(filePath);
      return null;
    }

    const { frontmatter, body } = parseMdc(raw);
    const name = deriveRuleName(filePath);

    const rule: Rule = {
      name,
      sourcePath: filePath,
      source,
      frontmatter,
      body,
    };

    this.cache.set(filePath, { rule, mtimeMs });
    return rule;
  }

  /**
   * Load legacy .cursorrules flat file (always-apply, no frontmatter).
   */
  private async loadLegacyFile(filePath: string): Promise<Rule | null> {
    let mtimeMs: number;
    try {
      const s = await stat(filePath);
      mtimeMs = s.mtimeMs;
    } catch {
      return null;
    }

    const cached = this.cache.get(filePath);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.rule;
    }

    let raw: string;
    try {
      raw = await Bun.file(filePath).text();
    } catch {
      return null;
    }

    if (raw.length === 0) return null;

    const rule: Rule = {
      name: ".cursorrules",
      sourcePath: filePath,
      source: "legacy",
      frontmatter: {
        globs: [],
        alwaysApply: true,
      },
      body: raw,
    };

    this.cache.set(filePath, { rule, mtimeMs });
    return rule;
  }

  /**
   * Clear the entire cache. Useful for testing or forced reload.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get current cache size (for diagnostics).
   */
  get cacheSize(): number {
    return this.cache.size;
  }
}

/**
 * Derive rule name from file path: strip extension and directory.
 * e.g. "/path/to/typescript-standards.mdc" → "typescript-standards"
 */
function deriveRuleName(filePath: string): string {
  const base = basename(filePath);
  const dotIdx = base.lastIndexOf(".");
  return dotIdx > 0 ? base.slice(0, dotIdx) : base;
}
