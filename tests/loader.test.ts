import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RuleLoader } from "../src/loader";

const FIXTURES_DIR = join(import.meta.dir, "fixtures", "loader-test");
const USER_RULES = join(FIXTURES_DIR, "user-rules");
const PROJECT_RULES = join(FIXTURES_DIR, "project-rules");
const LEGACY_FILE = join(FIXTURES_DIR, ".cursorrules");

function createDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

function writeRule(dir: string, name: string, content: string) {
  writeFileSync(join(dir, name), content, "utf-8");
}

describe("RuleLoader", () => {
  let loader: RuleLoader;

  beforeEach(() => {
    loader = new RuleLoader();
    // Clean up any previous test fixtures
    rmSync(FIXTURES_DIR, { recursive: true, force: true });
    createDir(USER_RULES);
    createDir(PROJECT_RULES);
  });

  afterEach(() => {
    rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });

  describe("loadAll", () => {
    test("loads rules from both user and project directories", async () => {
      writeRule(
        USER_RULES,
        "user-rule.mdc",
        `---
description: "User rule"
alwaysApply: true
---
User rule content.`,
      );

      writeRule(
        PROJECT_RULES,
        "project-rule.mdc",
        `---
description: "Project rule"
globs: "*.ts"
---
Project rule content.`,
      );

      const rules = await loader.loadAll(USER_RULES, PROJECT_RULES, null);

      expect(rules.length).toBe(2);
      expect(rules.find((r) => r.name === "user-rule")).toBeDefined();
      expect(rules.find((r) => r.name === "project-rule")).toBeDefined();
    });

    test("project rules override user rules on name collision", async () => {
      writeRule(
        USER_RULES,
        "shared.mdc",
        `---
description: "User version"
---
User content.`,
      );

      writeRule(
        PROJECT_RULES,
        "shared.mdc",
        `---
description: "Project version"
---
Project content.`,
      );

      const rules = await loader.loadAll(USER_RULES, PROJECT_RULES, null);

      expect(rules.length).toBe(1);
      expect(rules[0]?.source).toBe("project");
      expect(rules[0]?.frontmatter.description).toBe("Project version");
    });

    test("loads legacy .cursorrules file", async () => {
      writeFileSync(LEGACY_FILE, "Legacy cursor rules content.", "utf-8");

      const rules = await loader.loadAll(null, null, LEGACY_FILE);

      expect(rules.length).toBe(1);
      expect(rules[0]?.name).toBe(".cursorrules");
      expect(rules[0]?.source).toBe("legacy");
      expect(rules[0]?.frontmatter.alwaysApply).toBe(true);
      expect(rules[0]?.body).toBe("Legacy cursor rules content.");
    });

    test("handles missing directories gracefully", async () => {
      const rules = await loader.loadAll(
        "/nonexistent/user/rules",
        "/nonexistent/project/rules",
        "/nonexistent/.cursorrules",
      );

      expect(rules.length).toBe(0);
    });

    test("handles null paths gracefully", async () => {
      const rules = await loader.loadAll(null, null, null);
      expect(rules.length).toBe(0);
    });

    test("skips empty files", async () => {
      writeRule(PROJECT_RULES, "empty.mdc", "");
      writeRule(
        PROJECT_RULES,
        "valid.mdc",
        `---
description: test
---
content`,
      );

      const rules = await loader.loadAll(null, PROJECT_RULES, null);

      expect(rules.length).toBe(1);
      expect(rules[0]?.name).toBe("valid");
    });
  });

  describe("file formats", () => {
    test("loads .md files", async () => {
      writeRule(
        PROJECT_RULES,
        "rule.md",
        `---
description: MD rule
---
Content.`,
      );

      const rules = await loader.loadAll(null, PROJECT_RULES, null);
      expect(rules.length).toBe(1);
      expect(rules[0]?.name).toBe("rule");
    });

    test("loads .mdc files", async () => {
      writeRule(
        PROJECT_RULES,
        "rule.mdc",
        `---
description: MDC rule
---
Content.`,
      );

      const rules = await loader.loadAll(null, PROJECT_RULES, null);
      expect(rules.length).toBe(1);
      expect(rules[0]?.name).toBe("rule");
    });

    test("loads mixed .mdc and .md files", async () => {
      writeRule(
        PROJECT_RULES,
        "alpha.mdc",
        `---
description: alpha
---
Alpha.`,
      );

      writeRule(
        PROJECT_RULES,
        "beta.md",
        `---
description: beta
---
Beta.`,
      );

      const rules = await loader.loadAll(null, PROJECT_RULES, null);
      expect(rules.length).toBe(2);
    });
  });

  describe("caching", () => {
    test("caches rules on second load (same mtime)", async () => {
      writeRule(
        PROJECT_RULES,
        "cached.mdc",
        `---
description: cached rule
---
Content.`,
      );

      // First load
      const rules1 = await loader.loadAll(null, PROJECT_RULES, null);
      expect(rules1.length).toBe(1);
      expect(loader.cacheSize).toBe(1);

      // Second load (should hit cache)
      const rules2 = await loader.loadAll(null, PROJECT_RULES, null);
      expect(rules2.length).toBe(1);
      expect(rules2[0]?.frontmatter.description).toBe("cached rule");
    });

    test("invalidates cache when file changes", async () => {
      const filePath = join(PROJECT_RULES, "changing.mdc");
      writeRule(
        PROJECT_RULES,
        "changing.mdc",
        `---
description: "version 1"
---
Content v1.`,
      );

      // First load
      const rules1 = await loader.loadAll(null, PROJECT_RULES, null);
      expect(rules1[0]?.frontmatter.description).toBe("version 1");

      // Modify file (ensure different mtime by bumping it)
      await Bun.sleep(10);
      writeRule(
        PROJECT_RULES,
        "changing.mdc",
        `---
description: "version 2"
---
Content v2.`,
      );

      // Force mtime change
      const future = new Date(Date.now() + 1000);
      utimesSync(filePath, future, future);

      // Second load (should invalidate cache)
      const rules2 = await loader.loadAll(null, PROJECT_RULES, null);
      expect(rules2[0]?.frontmatter.description).toBe("version 2");
    });

    test("clearCache resets all cached entries", async () => {
      writeRule(
        PROJECT_RULES,
        "rule.mdc",
        `---
description: test
---
Content.`,
      );

      await loader.loadAll(null, PROJECT_RULES, null);
      expect(loader.cacheSize).toBe(1);

      loader.clearCache();
      expect(loader.cacheSize).toBe(0);
    });
  });

  describe("symlinks", () => {
    test("follows symlinked rule files", async () => {
      const sourceDir = join(FIXTURES_DIR, "source-rules");
      createDir(sourceDir);
      writeRule(
        sourceDir,
        "symlinked.mdc",
        `---
description: "Symlinked rule"
alwaysApply: true
---
Symlinked content.`,
      );

      // Create symlink
      const linkPath = join(PROJECT_RULES, "symlinked.mdc");
      symlinkSync(join(sourceDir, "symlinked.mdc"), linkPath);

      const rules = await loader.loadAll(null, PROJECT_RULES, null);

      expect(rules.length).toBe(1);
      expect(rules[0]?.name).toBe("symlinked");
      expect(rules[0]?.frontmatter.alwaysApply).toBe(true);
    });

    test("follows symlinked directories", async () => {
      const cursorRulesDir = join(FIXTURES_DIR, "cursor-rules");
      createDir(cursorRulesDir);
      writeRule(
        cursorRulesDir,
        "from-cursor.mdc",
        `---
description: "From .cursor/rules"
---
Cursor rule content.`,
      );

      // Symlink entire directory
      const linkedDir = join(FIXTURES_DIR, "linked-rules");
      symlinkSync(cursorRulesDir, linkedDir);

      const rules = await loader.loadAll(null, linkedDir, null);

      expect(rules.length).toBe(1);
      expect(rules[0]?.name).toBe("from-cursor");
    });

    test("handles broken symlinks gracefully", async () => {
      // Create symlink to non-existent target
      const brokenLink = join(PROJECT_RULES, "broken.mdc");
      try {
        symlinkSync("/nonexistent/file.mdc", brokenLink);
      } catch {
        // Symlink creation might fail on some systems
        return;
      }

      writeRule(
        PROJECT_RULES,
        "valid.mdc",
        `---
description: valid
---
Valid content.`,
      );

      const rules = await loader.loadAll(null, PROJECT_RULES, null);

      // Should load the valid rule and skip the broken symlink
      expect(rules.length).toBe(1);
      expect(rules[0]?.name).toBe("valid");
    });
  });

  describe("rule source tagging", () => {
    test("tags user rules with source 'user'", async () => {
      writeRule(
        USER_RULES,
        "user.mdc",
        `---
description: test
---
content`,
      );

      const rules = await loader.loadAll(USER_RULES, null, null);
      expect(rules[0]?.source).toBe("user");
    });

    test("tags project rules with source 'project'", async () => {
      writeRule(
        PROJECT_RULES,
        "project.mdc",
        `---
description: test
---
content`,
      );

      const rules = await loader.loadAll(null, PROJECT_RULES, null);
      expect(rules[0]?.source).toBe("project");
    });

    test("tags legacy rules with source 'legacy'", async () => {
      writeFileSync(LEGACY_FILE, "legacy content", "utf-8");

      const rules = await loader.loadAll(null, null, LEGACY_FILE);
      expect(rules[0]?.source).toBe("legacy");
    });
  });
});
