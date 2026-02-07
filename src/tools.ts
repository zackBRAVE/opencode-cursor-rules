import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Rule } from "./types";

/**
 * Get the user rules directory path (respects XDG_CONFIG_HOME)
 */
export function getUserRulesDir(): string {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configHome, "opencode", "rules");
}

/**
 * Get the project rules directory path
 */
export function getProjectRulesDir(worktree?: string): string {
  const projectRoot = worktree || process.cwd();
  return join(projectRoot, ".opencode", "rules");
}

/**
 * Ensure the rules directory exists
 */
async function ensureRulesDir(dir: string): Promise<void> {
  try {
    await access(dir);
  } catch {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Sanitize rule name for filename
 */
function sanitizeRuleName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-_\s]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/**
 * Generate MDC file content
 */
function generateMdcContent(
  description: string,
  content: string,
  globs?: string[],
  alwaysApply?: boolean,
): string {
  const frontmatterLines: string[] = [];

  if (description) {
    frontmatterLines.push(`description: "${description}"`);
  }

  if (globs && globs.length > 0) {
    if (globs.length === 1) {
      frontmatterLines.push(`globs: "${globs[0]}"`);
    } else {
      frontmatterLines.push(`globs:`);
      for (const glob of globs) {
        frontmatterLines.push(`  - "${glob}"`);
      }
    }
  }

  if (alwaysApply) {
    frontmatterLines.push(`alwaysApply: true`);
  }

  const frontmatter =
    frontmatterLines.length > 0 ? `---\n${frontmatterLines.join("\n")}\n---\n\n` : "";

  return frontmatter + content;
}

/**
 * Determine the rule mode based on frontmatter
 */
function getRuleMode(rule: Rule): string {
  if (rule.frontmatter.alwaysApply) return "always";
  if (rule.frontmatter.globs.length > 0) return "glob";
  if (rule.frontmatter.description) return "agent";
  return "manual";
}

/**
 * Create a user-level rule file
 */
export async function createUserRule(
  name: string,
  description: string,
  content: string,
  globs?: string[],
  alwaysApply?: boolean,
): Promise<{ success: boolean; message: string; filePath?: string }> {
  try {
    const rulesDir = getUserRulesDir();
    await ensureRulesDir(rulesDir);

    const sanitizedName = sanitizeRuleName(name);
    if (!sanitizedName) {
      return { success: false, message: "Invalid rule name provided" };
    }

    const fileName = `${sanitizedName}.mdc`;
    const filePath = join(rulesDir, fileName);

    const mdcContent = generateMdcContent(description, content, globs, alwaysApply);
    await writeFile(filePath, mdcContent, "utf-8");

    return {
      success: true,
      message: `Created user-level rule "${sanitizedName}" at ${filePath}`,
      filePath,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to create user rule: ${errorMessage}`,
    };
  }
}

/**
 * Create a project-level rule file
 */
export async function createProjectRule(
  name: string,
  description: string,
  content: string,
  globs?: string[],
  alwaysApply?: boolean,
  worktree?: string,
): Promise<{ success: boolean; message: string; filePath?: string }> {
  try {
    const rulesDir = getProjectRulesDir(worktree);
    await ensureRulesDir(rulesDir);

    const sanitizedName = sanitizeRuleName(name);
    if (!sanitizedName) {
      return { success: false, message: "Invalid rule name provided" };
    }

    const fileName = `${sanitizedName}.mdc`;
    const filePath = join(rulesDir, fileName);

    const mdcContent = generateMdcContent(description, content, globs, alwaysApply);
    await writeFile(filePath, mdcContent, "utf-8");

    return {
      success: true,
      message: `Created project-level rule "${sanitizedName}" at ${filePath}`,
      filePath,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to create project rule: ${errorMessage}`,
    };
  }
}

/**
 * List all loaded rules with their loading strategies
 */
export async function listRules(
  userRulesDir: string,
  projectRulesDir: string,
  legacyFilePath: string | null,
  loader: {
    loadAll: (
      user: string | null,
      project: string | null,
      legacy: string | null,
    ) => Promise<Rule[]>;
  },
): Promise<{
  success: boolean;
  message: string;
  rules?: Array<{
    name: string;
    source: string;
    mode: string;
    description?: string;
    globs: string[];
    alwaysApply: boolean;
    filePath: string;
  }>;
}> {
  try {
    const rules = await loader.loadAll(userRulesDir, projectRulesDir, legacyFilePath);

    if (rules.length === 0) {
      return {
        success: true,
        message: "No rules found. Create rules using /create-user-rule or /create-project-rule.",
        rules: [],
      };
    }

    const formattedRules = rules.map((rule) => ({
      name: rule.name,
      source: rule.source,
      mode: getRuleMode(rule),
      description: rule.frontmatter.description,
      globs: rule.frontmatter.globs,
      alwaysApply: rule.frontmatter.alwaysApply,
      filePath: rule.sourcePath,
    }));

    // Sort by source (user first, then project, then legacy)
    formattedRules.sort((a, b) => {
      const sourceOrder = { user: 0, project: 1, legacy: 2 };
      return (
        sourceOrder[a.source as keyof typeof sourceOrder] -
        sourceOrder[b.source as keyof typeof sourceOrder]
      );
    });

    return {
      success: true,
      message: `Found ${rules.length} rule(s)`,
      rules: formattedRules,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to list rules: ${errorMessage}`,
    };
  }
}
