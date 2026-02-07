import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RuleLoader } from "../src/loader";
import {
  createProjectRule,
  createUserRule,
  getProjectRulesDir,
  getUserRulesDir,
  listRules,
} from "../src/tools";

const FIXTURES_DIR = join(import.meta.dir, "fixtures", "tools-test");
const TEST_USER_RULES = join(FIXTURES_DIR, "user-rules");
const TEST_PROJECT_RULES = join(FIXTURES_DIR, "project-rules");

// Store original env var
let originalXdgConfigHome: string | undefined;

describe("tools", () => {
  beforeEach(() => {
    // Store original XDG_CONFIG_HOME
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

    // Clean up and create test directories
    rmSync(FIXTURES_DIR, { recursive: true, force: true });
    mkdirSync(TEST_USER_RULES, { recursive: true });
    mkdirSync(TEST_PROJECT_RULES, { recursive: true });
  });

  afterEach(() => {
    // Restore original env var
    if (originalXdgConfigHome !== undefined) {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }

    // Clean up test fixtures
    rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });

  describe("createUserRule", () => {
    test("creates a user-level rule file with correct content", async () => {
      const result = await createUserRule(
        "test-rule",
        "Test rule description",
        "This is the rule content.",
        ["**/*.ts"],
        false,
      );

      expect(result.success).toBe(true);
      expect(result.filePath).toBeDefined();
      expect(result.filePath?.endsWith("test-rule.mdc")).toBe(true);
      expect(existsSync(result.filePath!)).toBe(true);

      const content = readFileSync(result.filePath!, "utf-8");
      expect(content).toContain('description: "Test rule description"');
      expect(content).toContain('globs: "**/*.ts"');
      expect(content).toContain("This is the rule content.");
      expect(content).not.toContain("alwaysApply");
    });

    test("creates rule with alwaysApply set to true", async () => {
      const result = await createUserRule(
        "always-rule",
        "Always apply rule",
        "Always apply content.",
        [],
        true,
      );

      expect(result.success).toBe(true);

      const content = readFileSync(result.filePath!, "utf-8");
      expect(content).toContain("alwaysApply: true");
    });

    test("creates rule with multiple globs", async () => {
      const result = await createUserRule(
        "multi-glob-rule",
        "Multi glob rule",
        "Content.",
        ["**/*.ts", "**/*.tsx"],
        false,
      );

      expect(result.success).toBe(true);

      const content = readFileSync(result.filePath!, "utf-8");
      expect(content).toContain("globs:");
      expect(content).toContain('  - "**/*.ts"');
      expect(content).toContain('  - "**/*.tsx"');
    });

    test("creates rule without globs or alwaysApply", async () => {
      const result = await createUserRule("simple-rule", "Simple rule", "Simple content.");

      expect(result.success).toBe(true);

      const content = readFileSync(result.filePath!, "utf-8");
      expect(content).toContain('description: "Simple rule"');
      expect(content).not.toContain("globs");
      expect(content).not.toContain("alwaysApply");
    });

    test("sanitizes rule names", async () => {
      const result = await createUserRule("My Special Rule!", "Description", "Content.");

      expect(result.success).toBe(true);
      expect(result.filePath?.endsWith("my-special-rule.mdc")).toBe(true);
    });

    test("creates directory if it doesn't exist", async () => {
      // Temporarily mock the user rules dir
      process.env.XDG_CONFIG_HOME = FIXTURES_DIR;

      const result = await createUserRule("deep-rule", "Deep rule", "Content.");

      expect(result.success).toBe(true);
      expect(existsSync(result.filePath!)).toBe(true);
    });

    test("handles invalid rule names gracefully", async () => {
      process.env.XDG_CONFIG_HOME = FIXTURES_DIR;

      const result = await createUserRule("!!!@@@###$$$", "Invalid rule", "Content");

      expect(result.success).toBe(false);
      expect(result.message).toContain("Invalid rule name");
    });

    test("handles file write errors gracefully", async () => {
      // Create a file where we expect a directory - this will cause mkdir to fail
      const blockingPath = join(FIXTURES_DIR, "blocking-file");
      writeFileSync(blockingPath, "blocking content", "utf-8");
      process.env.XDG_CONFIG_HOME = blockingPath;

      const result = await createUserRule("error-test", "Error test", "Content");

      expect(result.success).toBe(false);
      expect(result.message).toContain("Failed to create user rule");
    });

    test("sanitizes rule names with special characters", async () => {
      process.env.XDG_CONFIG_HOME = FIXTURES_DIR;

      const result = await createUserRule(
        "My Rule With Spaces & Special@Chars!",
        "Sanitized rule",
        "Content",
      );

      expect(result.success).toBe(true);
      expect(result.filePath).toContain("my-rule-with-spaces-specialchars.mdc");
    });

    test("returns success message with correct rule name", async () => {
      process.env.XDG_CONFIG_HOME = FIXTURES_DIR;

      const result = await createUserRule("success-test", "Success test", "Content");

      expect(result.success).toBe(true);
      expect(result.message).toContain("Created user-level rule");
      expect(result.message).toContain("success-test");
      expect(result.filePath).toBeDefined();
    });
  });

  describe("createProjectRule", () => {
    test("creates a project-level rule file", async () => {
      const result = await createProjectRule(
        "project-rule",
        "Project rule description",
        "Project content.",
        ["**/*.js"],
        false,
      );

      expect(result.success).toBe(true);
      expect(result.filePath).toBeDefined();
      expect(result.filePath?.includes(".opencode/rules")).toBe(true);
      expect(existsSync(result.filePath!)).toBe(true);
    });

    test("uses provided worktree directory", async () => {
      const customWorktree = join(FIXTURES_DIR, "custom-project");
      mkdirSync(join(customWorktree, ".opencode", "rules"), {
        recursive: true,
      });

      const result = await createProjectRule(
        "custom-rule",
        "Custom rule",
        "Content.",
        [],
        false,
        customWorktree,
      );

      expect(result.success).toBe(true);
      expect(result.filePath?.includes(customWorktree)).toBe(true);
    });

    test("creates .opencode/rules/ directory structure if needed", async () => {
      const freshProjectDir = join(FIXTURES_DIR, "fresh-project");
      // Don't create the .opencode/rules directory - let the function do it

      const result = await createProjectRule(
        "auto-dir-rule",
        "Auto dir rule",
        "Content",
        undefined,
        undefined,
        freshProjectDir,
      );

      expect(result.success).toBe(true);
      expect(existsSync(join(freshProjectDir, ".opencode", "rules"))).toBe(true);
      expect(existsSync(result.filePath!)).toBe(true);
    });

    test("sanitizes project rule names correctly", async () => {
      const result = await createProjectRule(
        "My Project Rule!!!",
        "Sanitized project rule",
        "Content",
        undefined,
        undefined,
        FIXTURES_DIR,
      );

      expect(result.success).toBe(true);
      expect(result.filePath).toContain("my-project-rule.mdc");
    });

    test("handles file write errors gracefully for project rules", async () => {
      // Create a file where we expect a directory - this will cause mkdir to fail
      const blockingPath = join(FIXTURES_DIR, "project-blocking");
      writeFileSync(blockingPath, "blocking content", "utf-8");

      const result = await createProjectRule(
        "error-test",
        "Error test",
        "Content",
        undefined,
        undefined,
        blockingPath,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Failed to create project rule");
    });

    test("combines globs and alwaysApply for project rules", async () => {
      const result = await createProjectRule(
        "combined-project-rule",
        "Combined rule",
        "Content",
        ["src/**/*.ts", "lib/**/*.ts"],
        true,
        FIXTURES_DIR,
      );

      expect(result.success).toBe(true);

      const content = readFileSync(result.filePath!, "utf-8");
      expect(content).toContain("globs:");
      expect(content).toContain('- "src/**/*.ts"');
      expect(content).toContain('- "lib/**/*.ts"');
      expect(content).toContain("alwaysApply: true");
      expect(content).toContain('description: "Combined rule"');
    });

    test("returns success message with correct project rule name", async () => {
      const result = await createProjectRule(
        "success-project-rule",
        "Success project rule",
        "Content",
        undefined,
        undefined,
        FIXTURES_DIR,
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("Created project-level rule");
      expect(result.message).toContain("success-project-rule");
    });
  });

  describe("listRules", () => {
    test("returns formatted list of all rules", async () => {
      // Mock the loadAll method to return test rules
      const mockRules = [
        {
          name: "user-rule",
          filePath: "/user/rules/user-rule.mdc",
          frontmatter: {
            description: "User rule",
            globs: [],
            alwaysApply: true,
          },
          content: "User content",
          source: "user" as const,
        },
        {
          name: "project-rule",
          filePath: "/project/.opencode/rules/project-rule.mdc",
          frontmatter: {
            description: "Project rule",
            globs: ["**/*.ts"],
            alwaysApply: false,
          },
          content: "Project content",
          source: "project" as const,
        },
        {
          name: "agent-rule",
          filePath: "/user/rules/agent-rule.mdc",
          frontmatter: {
            description: "Agent rule description",
            globs: [],
            alwaysApply: false,
          },
          content: "Agent content",
          source: "user" as const,
        },
        {
          name: "manual-rule",
          filePath: "/user/rules/manual-rule.mdc",
          frontmatter: {
            description: "",
            globs: [],
            alwaysApply: false,
          },
          content: "Manual content",
          source: "user" as const,
        },
      ];

      const mockLoader = {
        loadAll: async () => mockRules,
      };

      const result = await listRules(TEST_USER_RULES, TEST_PROJECT_RULES, null, mockLoader as any);

      expect(result.success).toBe(true);
      expect(result.rules).toBeDefined();
      expect(result.rules?.length).toBe(4);

      // Check user rules
      const userRules = result.rules?.filter((r) => r.source === "user");
      expect(userRules?.length).toBe(3);

      // Check project rules
      const projectRules = result.rules?.filter((r) => r.source === "project");
      expect(projectRules?.length).toBe(1);

      // Check mode badges
      const alwaysRule = result.rules?.find((r) => r.name === "user-rule");
      expect(alwaysRule?.mode).toContain("always");

      const globRule = result.rules?.find((r) => r.name === "project-rule");
      expect(globRule?.mode).toContain("glob");

      const agentRule = result.rules?.find((r) => r.name === "agent-rule");
      expect(agentRule?.mode).toContain("agent");

      const manualRule = result.rules?.find((r) => r.name === "manual-rule");
      expect(manualRule?.mode).toContain("manual");
    });

    test("handles empty rules list", async () => {
      const mockLoader = {
        loadAll: async () => [],
      };

      const result = await listRules(TEST_USER_RULES, TEST_PROJECT_RULES, null, mockLoader as any);

      expect(result.success).toBe(true);
      expect(result.rules).toEqual([]);
    });

    test("handles loader errors", async () => {
      const mockLoader = {
        loadAll: async () => {
          throw new Error("Loader failed");
        },
      };

      const result = await listRules(TEST_USER_RULES, TEST_PROJECT_RULES, null, mockLoader as any);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Failed to list rules");
    });

    test("groups rules by source with real loader (user, project, legacy)", async () => {
      const realLoader = new RuleLoader();

      // Create user rules directory and rule
      const userRulesDir = join(FIXTURES_DIR, "real-user", "opencode", "rules");
      mkdirSync(userRulesDir, { recursive: true });
      writeFileSync(
        join(userRulesDir, "user-rule.mdc"),
        `---
description: "User rule"
---
User content.`,
      );

      // Create project rules directory and rule
      const projectRulesDir = join(FIXTURES_DIR, "real-project", ".opencode", "rules");
      mkdirSync(projectRulesDir, { recursive: true });
      writeFileSync(
        join(projectRulesDir, "project-rule.mdc"),
        `---
description: "Project rule"
---
Project content.`,
      );

      // Create legacy file
      const legacyFile = join(FIXTURES_DIR, "real-legacy", ".cursorrules");
      mkdirSync(join(FIXTURES_DIR, "real-legacy"), { recursive: true });
      writeFileSync(legacyFile, "Legacy rules content");

      const result = await listRules(userRulesDir, projectRulesDir, legacyFile, realLoader);

      expect(result.success).toBe(true);
      expect(result.rules).toBeDefined();
      expect(result.rules?.length).toBe(3);

      const rules = result.rules!;
      // Verify order: user first, then project, then legacy
      expect(rules.length).toBeGreaterThanOrEqual(3);
      expect(rules[0]?.source).toBe("user");
      expect(rules[0]?.name).toBe("user-rule");

      expect(rules[1]?.source).toBe("project");
      expect(rules[1]?.name).toBe("project-rule");

      expect(rules[2]?.source).toBe("legacy");
      expect(rules[2]?.name).toBe(".cursorrules");
    });

    test("correctly identifies all mode badges with real loader", async () => {
      const realLoader = new RuleLoader();
      const rulesDir = join(FIXTURES_DIR, "modes-test", ".opencode", "rules");
      mkdirSync(rulesDir, { recursive: true });

      // Always mode
      writeFileSync(
        join(rulesDir, "always-rule.mdc"),
        `---
description: "Always rule"
alwaysApply: true
---
Always content.`,
      );

      // Glob mode
      writeFileSync(
        join(rulesDir, "glob-rule.mdc"),
        `---
description: "Glob rule"
globs: "*.ts"
---
Glob content.`,
      );

      // Agent mode (description only)
      writeFileSync(
        join(rulesDir, "agent-rule.mdc"),
        `---
description: "Agent rule"
---
Agent content.`,
      );

      // Manual mode (no frontmatter)
      writeFileSync(
        join(rulesDir, "manual-rule.mdc"),
        `---
---
Manual content.`,
      );

      const result = await listRules("", rulesDir, null, realLoader);

      expect(result.success).toBe(true);
      expect(result.rules).toBeDefined();
      expect(result.rules?.length).toBe(4);

      const rules = result.rules!;
      const alwaysRule = rules.find((r) => r.name === "always-rule");
      const globRule = rules.find((r) => r.name === "glob-rule");
      const agentRule = rules.find((r) => r.name === "agent-rule");
      const manualRule = rules.find((r) => r.name === "manual-rule");

      expect(alwaysRule).toBeDefined();
      expect(alwaysRule?.mode).toBe("always");
      expect(alwaysRule?.alwaysApply).toBe(true);

      expect(globRule).toBeDefined();
      expect(globRule?.mode).toBe("glob");
      expect(globRule?.globs).toEqual(["*.ts"]);

      expect(agentRule).toBeDefined();
      expect(agentRule?.mode).toBe("agent");
      expect(agentRule?.description).toBe("Agent rule");

      expect(manualRule).toBeDefined();
      expect(manualRule?.mode).toBe("manual");
    });

    test("correctly handles multiple globs with real loader", async () => {
      const realLoader = new RuleLoader();
      const rulesDir = join(FIXTURES_DIR, "multiglob-test", ".opencode", "rules");
      mkdirSync(rulesDir, { recursive: true });

      writeFileSync(
        join(rulesDir, "multiglob-rule.mdc"),
        `---
description: "Multi glob rule"
globs:
  - "*.ts"
  - "*.tsx"
  - "*.js"
---
Multi glob content.`,
      );

      const result = await listRules("", rulesDir, null, realLoader);

      expect(result.success).toBe(true);
      expect(result.rules).toBeDefined();
      expect(result.rules?.length).toBe(1);

      const rule = result.rules?.[0]!;
      expect(rule.name).toBe("multiglob-rule");
      expect(rule.mode).toBe("glob");
      expect(rule.globs).toEqual(["*.ts", "*.tsx", "*.js"]);
    });

    test("includes correct file paths in output", async () => {
      const realLoader = new RuleLoader();
      const rulesDir = join(FIXTURES_DIR, "paths-test", ".opencode", "rules");
      mkdirSync(rulesDir, { recursive: true });

      writeFileSync(
        join(rulesDir, "path-test-rule.mdc"),
        `---
description: "Path test rule"
---
Content.`,
      );

      const result = await listRules("", rulesDir, null, realLoader);

      expect(result.success).toBe(true);
      expect(result.rules).toBeDefined();
      expect(result.rules?.length).toBe(1);

      const rule = result.rules?.[0]!;
      expect(rule.filePath).toContain("path-test-rule.mdc");
      expect(rule.filePath).toContain("paths-test");
    });

    test("handles legacy .cursorrules file correctly", async () => {
      const realLoader = new RuleLoader();
      const legacyDir = join(FIXTURES_DIR, "legacy-test");
      mkdirSync(legacyDir, { recursive: true });

      const legacyFile = join(legacyDir, ".cursorrules");
      writeFileSync(legacyFile, "Legacy cursor rules content line 1\nLine 2\nLine 3");

      const result = await listRules("", "", legacyFile, realLoader);

      expect(result.success).toBe(true);
      expect(result.rules).toBeDefined();
      expect(result.rules?.length).toBe(1);

      const legacyRule = result.rules?.[0]!;
      expect(legacyRule.name).toBe(".cursorrules");
      expect(legacyRule.source).toBe("legacy");
      expect(legacyRule.mode).toBe("always");
      expect(legacyRule.alwaysApply).toBe(true);
      expect(legacyRule.globs).toEqual([]);
      expect(legacyRule.filePath).toBe(legacyFile);
    });
  });

  describe("getUserRulesDir", () => {
    test("returns default path when XDG_CONFIG_HOME not set", () => {
      const originalEnv = process.env.XDG_CONFIG_HOME;
      delete process.env.XDG_CONFIG_HOME;

      try {
        const dir = getUserRulesDir();
        expect(dir).toContain(".config/opencode/rules");
      } finally {
        if (originalEnv) {
          process.env.XDG_CONFIG_HOME = originalEnv;
        }
      }
    });

    test("respects XDG_CONFIG_HOME", () => {
      const originalEnv = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = "/custom/config";

      try {
        const dir = getUserRulesDir();
        expect(dir).toBe("/custom/config/opencode/rules");
      } finally {
        if (originalEnv) {
          process.env.XDG_CONFIG_HOME = originalEnv;
        } else {
          delete process.env.XDG_CONFIG_HOME;
        }
      }
    });
  });

  describe("getProjectRulesDir", () => {
    test("returns default path in current directory", () => {
      const dir = getProjectRulesDir();
      expect(dir).toContain(".opencode/rules");
    });

    test("uses provided worktree", () => {
      const dir = getProjectRulesDir("/custom/project");
      expect(dir).toBe("/custom/project/.opencode/rules");
    });
  });
});
