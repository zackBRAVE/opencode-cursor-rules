import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RuleLoader } from "../src/loader";
import { formatSystemPromptSection, selectRules } from "../src/matcher";
import type { SessionState } from "../src/types";

const FIXTURES_DIR = join(import.meta.dir, "fixtures", "integration-test");
const USER_RULES_DIR = join(FIXTURES_DIR, "config", "opencode", "rules");
const PROJECT_DIR = join(FIXTURES_DIR, "project");
const PROJECT_RULES_DIR = join(PROJECT_DIR, ".opencode", "rules");
const CURSOR_RULES_DIR = join(PROJECT_DIR, ".cursor", "rules");
const LEGACY_FILE = join(PROJECT_DIR, ".cursorrules");

function createDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

function writeRule(dir: string, name: string, content: string) {
  writeFileSync(join(dir, name), content, "utf-8");
}

describe("Integration: Full Pipeline", () => {
  let loader: RuleLoader;

  beforeEach(() => {
    loader = new RuleLoader();
    rmSync(FIXTURES_DIR, { recursive: true, force: true });
    createDir(USER_RULES_DIR);
    createDir(PROJECT_RULES_DIR);
  });

  afterEach(() => {
    rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });

  test("end-to-end: three-tier rule categorization", async () => {
    // Always-apply rule (user level)
    writeRule(
      USER_RULES_DIR,
      "bun-preference.mdc",
      `---
description: "Use Bun instead of Node.js"
alwaysApply: true
---

Default to using Bun for all tasks.
- Use \`bun test\` instead of jest
- Use \`bun run\` instead of npm run`,
    );

    // Glob rule (project level) — should go to suggested
    writeRule(
      PROJECT_RULES_DIR,
      "typescript-standards.mdc",
      `---
description: "TypeScript coding standards"
globs: "*.ts, *.tsx"
---

Use strict TypeScript. Prefer interfaces over types.`,
    );

    // Glob rule (project level) — should go to suggested
    writeRule(
      PROJECT_RULES_DIR,
      "react-patterns.mdc",
      `---
description: "React component best practices"
globs: "*.tsx, src/components/**"
---

Use functional components with hooks.`,
    );

    // Description-only rule — should go to available
    writeRule(
      PROJECT_RULES_DIR,
      "api-design.mdc",
      `---
description: "REST API design guidelines"
---

Use proper HTTP methods. Version your APIs.`,
    );

    // Manual rule (no frontmatter) — should not appear unless @-mentioned
    writeRule(
      PROJECT_RULES_DIR,
      "migration-guide.mdc",
      `# Legacy Migration Guide

When refactoring from v1 to v2:
1. Replace old hooks with new ones
2. Update import paths`,
    );

    const rules = await loader.loadAll(USER_RULES_DIR, PROJECT_RULES_DIR, null);
    expect(rules.length).toBe(5);

    const session: SessionState = {
      filePaths: new Set(["src/utils/helpers.ts", "src/components/Button.tsx"]),
      lastUserMessage: "Help me refactor this component",
    };

    const { injected, suggested, available } = selectRules(rules, session);

    // bun-preference: always-apply → injected (full content)
    expect(injected.find((m) => m.rule.name === "bun-preference")).toBeDefined();

    // typescript-standards: globs match *.ts → suggested (path only)
    expect(suggested.find((m) => m.rule.name === "typescript-standards")).toBeDefined();

    // react-patterns: globs match *.tsx → suggested (path only)
    expect(suggested.find((m) => m.rule.name === "react-patterns")).toBeDefined();

    // api-design: description only → available (path only)
    expect(available.find((r) => r.name === "api-design")).toBeDefined();

    // migration-guide: no frontmatter → nowhere (not @-mentioned)
    expect(injected.find((m) => m.rule.name === "migration-guide")).toBeUndefined();
    expect(suggested.find((m) => m.rule.name === "migration-guide")).toBeUndefined();
    expect(available.find((r) => r.name === "migration-guide")).toBeUndefined();

    // Format system prompt
    const prompt = formatSystemPromptSection(injected, suggested, available);
    expect(prompt).toContain("<rules>");
    // Only always-apply content is inline
    expect(prompt).toContain("Bun");
    // Glob-matched rules show as suggested with paths
    expect(prompt).toContain("<suggested_rules");
    expect(prompt).toContain("typescript-standards");
    expect(prompt).toContain(".mdc");
    // Available rules show descriptions with paths
    expect(prompt).toContain("<available_rules");
    expect(prompt).toContain("api-design");
    // Glob rule content should NOT be inline
    expect(prompt).not.toContain("Use strict TypeScript");
    expect(prompt).not.toContain("functional components");
  });

  test("@-mention triggers manual rule injection with full content", async () => {
    writeRule(
      PROJECT_RULES_DIR,
      "migration-guide.mdc",
      `# Migration Guide

Replace v1 APIs with v2 equivalents.`,
    );

    const rules = await loader.loadAll(null, PROJECT_RULES_DIR, null);

    const session: SessionState = {
      filePaths: new Set(),
      lastUserMessage: "Apply @migration-guide to this file",
    };

    const { injected } = selectRules(rules, session);
    expect(injected.length).toBe(1);
    expect(injected[0]?.rule.name).toBe("migration-guide");

    // @-mentioned rules get full content injected
    const prompt = formatSystemPromptSection(injected, [], []);
    expect(prompt).toContain("Replace v1 APIs with v2 equivalents.");
  });

  test("symlinked .cursor/rules directory works end-to-end", async () => {
    createDir(CURSOR_RULES_DIR);
    writeRule(
      CURSOR_RULES_DIR,
      "cursor-rule.mdc",
      `---
description: "Cursor rule via symlink"
alwaysApply: true
---

This rule comes from .cursor/rules via symlink.`,
    );

    // Symlink .opencode/rules → .cursor/rules
    rmSync(PROJECT_RULES_DIR, { recursive: true, force: true });
    symlinkSync(CURSOR_RULES_DIR, PROJECT_RULES_DIR);

    const rules = await loader.loadAll(null, PROJECT_RULES_DIR, null);
    expect(rules.length).toBe(1);
    expect(rules[0]?.name).toBe("cursor-rule");
    expect(rules[0]?.frontmatter.alwaysApply).toBe(true);

    const session: SessionState = { filePaths: new Set(), lastUserMessage: "" };
    const { injected } = selectRules(rules, session);
    expect(injected.length).toBe(1);

    const prompt = formatSystemPromptSection(injected, [], []);
    expect(prompt).toContain("This rule comes from .cursor/rules via symlink.");
  });

  test("legacy .cursorrules file integrates correctly", async () => {
    writeFileSync(
      LEGACY_FILE,
      `You are a helpful coding assistant.
Always explain your reasoning.
Follow clean code principles.`,
      "utf-8",
    );

    writeRule(
      PROJECT_RULES_DIR,
      "modern-rule.mdc",
      `---
description: "Modern project rule"
alwaysApply: true
---

Use modern patterns.`,
    );

    const rules = await loader.loadAll(null, PROJECT_RULES_DIR, LEGACY_FILE);
    expect(rules.length).toBe(2);

    const session: SessionState = { filePaths: new Set(), lastUserMessage: "" };
    const { injected } = selectRules(rules, session);

    // Both should be always-apply → injected
    expect(injected.length).toBe(2);
    expect(injected.map((m) => m.rule.name)).toContain("modern-rule");
    expect(injected.map((m) => m.rule.name)).toContain(".cursorrules");
  });

  test("project rules override user rules on name collision", async () => {
    writeRule(
      USER_RULES_DIR,
      "coding-style.mdc",
      `---
description: "User coding style"
alwaysApply: true
---

User preferences.`,
    );

    writeRule(
      PROJECT_RULES_DIR,
      "coding-style.mdc",
      `---
description: "Project coding style"
alwaysApply: true
---

Project-specific preferences.`,
    );

    const rules = await loader.loadAll(USER_RULES_DIR, PROJECT_RULES_DIR, null);
    expect(rules.length).toBe(1);
    expect(rules[0]?.source).toBe("project");
    expect(rules[0]?.body.trim()).toBe("Project-specific preferences.");
  });

  test("suggested rules include correct file paths with .mdc extension", async () => {
    writeRule(
      PROJECT_RULES_DIR,
      "my-rule.mdc",
      `---
description: "A glob rule"
globs: "*.ts"
---

Rule content.`,
    );

    const rules = await loader.loadAll(null, PROJECT_RULES_DIR, null);
    const session: SessionState = {
      filePaths: new Set(["app.ts"]),
      lastUserMessage: "",
    };

    const { suggested } = selectRules(rules, session);
    expect(suggested.length).toBe(1);

    // The sourcePath must have .mdc extension
    expect(suggested[0]?.rule.sourcePath).toEndWith(".mdc");

    // Formatted output must include the actual .mdc path
    const prompt = formatSystemPromptSection([], suggested, []);
    expect(prompt).toContain("my-rule.mdc");
    expect(prompt).toContain("Path:");
  });

  test("performance: loads 50 rules under 100ms", async () => {
    for (let i = 0; i < 50; i++) {
      writeRule(
        PROJECT_RULES_DIR,
        `rule-${i}.mdc`,
        `---
description: "Rule number ${i}"
globs: "*.ts"
alwaysApply: ${i < 5}
---

Rule ${i} content with some text to simulate real rules.`,
      );
    }

    const start = performance.now();
    const rules = await loader.loadAll(null, PROJECT_RULES_DIR, null);
    const elapsed = performance.now() - start;

    expect(rules.length).toBe(50);
    expect(elapsed).toBeLessThan(100);

    // Second load should be even faster (cached)
    const start2 = performance.now();
    await loader.loadAll(null, PROJECT_RULES_DIR, null);
    const elapsed2 = performance.now() - start2;

    expect(elapsed2).toBeLessThan(50);
  });

  test("performance: rule selection with many files is fast", async () => {
    for (let i = 0; i < 20; i++) {
      writeRule(
        PROJECT_RULES_DIR,
        `rule-${i}.mdc`,
        `---
globs: "src/**/*.ts, lib/**/*.ts, test/**/*.ts"
---
Rule ${i} content.`,
      );
    }

    const rules = await loader.loadAll(null, PROJECT_RULES_DIR, null);

    const filePaths = new Set<string>();
    for (let i = 0; i < 100; i++) {
      filePaths.add(`src/module-${i}/index.ts`);
    }

    const session: SessionState = { filePaths, lastUserMessage: "" };

    const start = performance.now();
    const { suggested } = selectRules(rules, session);
    const elapsed = performance.now() - start;

    expect(suggested.length).toBe(20); // All should match
    expect(elapsed).toBeLessThan(50);
  });
});
