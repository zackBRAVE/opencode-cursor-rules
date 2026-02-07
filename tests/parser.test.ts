import { describe, expect, test } from "bun:test";
import { parseMdc } from "../src/parser";

describe("parseMdc", () => {
  describe("frontmatter extraction", () => {
    test("parses valid frontmatter with all fields", () => {
      const raw = `---
description: "TypeScript coding standards"
globs: "*.ts, *.tsx"
alwaysApply: true
---

Use strict TypeScript mode.`;

      const result = parseMdc(raw);

      expect(result.frontmatter.description).toBe("TypeScript coding standards");
      expect(result.frontmatter.globs).toEqual(["*.ts", "*.tsx"]);
      expect(result.frontmatter.alwaysApply).toBe(true);
      expect(result.body.trim()).toBe("Use strict TypeScript mode.");
    });

    test("returns defaults when no frontmatter present", () => {
      const raw = "Just some markdown content.\nWith multiple lines.";
      const result = parseMdc(raw);

      expect(result.frontmatter.description).toBeUndefined();
      expect(result.frontmatter.globs).toEqual([]);
      expect(result.frontmatter.alwaysApply).toBe(false);
      expect(result.body).toBe(raw);
    });

    test("handles empty frontmatter", () => {
      const raw = `---
---
Body content here.`;

      const result = parseMdc(raw);

      expect(result.frontmatter.description).toBeUndefined();
      expect(result.frontmatter.globs).toEqual([]);
      expect(result.frontmatter.alwaysApply).toBe(false);
      expect(result.body.trim()).toBe("Body content here.");
    });

    test("handles empty string input", () => {
      const result = parseMdc("");

      expect(result.frontmatter.globs).toEqual([]);
      expect(result.frontmatter.alwaysApply).toBe(false);
      expect(result.body).toBe("");
    });

    test("handles malformed YAML gracefully", () => {
      const raw = `---
description: [invalid yaml: {
globs: missing: colon
---

Body content.`;

      const result = parseMdc(raw);

      // Should treat as no frontmatter
      expect(result.frontmatter.globs).toEqual([]);
      expect(result.frontmatter.alwaysApply).toBe(false);
      expect(result.body).toBe(raw);
    });

    test("preserves body content after frontmatter exactly", () => {
      const body = `# Title

Some content with **markdown**.

\`\`\`ts
const x = 1;
\`\`\`
`;
      const raw = `---
description: test
---
${body}`;

      const result = parseMdc(raw);
      expect(result.body).toBe(body);
    });
  });

  describe("globs normalization", () => {
    test("splits comma-separated string into array", () => {
      const raw = `---
globs: "*.ts, *.tsx, src/**/*.js"
---
body`;

      const result = parseMdc(raw);
      expect(result.frontmatter.globs).toEqual(["*.ts", "*.tsx", "src/**/*.js"]);
    });

    test("handles array format", () => {
      const raw = `---
globs:
  - "*.ts"
  - "*.tsx"
---
body`;

      const result = parseMdc(raw);
      expect(result.frontmatter.globs).toEqual(["*.ts", "*.tsx"]);
    });

    test("handles single string glob (no commas)", () => {
      const raw = `---
globs: "**/*.test.ts"
---
body`;

      const result = parseMdc(raw);
      expect(result.frontmatter.globs).toEqual(["**/*.test.ts"]);
    });

    test("trims whitespace from globs", () => {
      const raw = `---
globs: "  *.ts ,  *.tsx  "
---
body`;

      const result = parseMdc(raw);
      expect(result.frontmatter.globs).toEqual(["*.ts", "*.tsx"]);
    });

    test("filters empty strings from globs", () => {
      const raw = `---
globs: "*.ts, , *.tsx, "
---
body`;

      const result = parseMdc(raw);
      expect(result.frontmatter.globs).toEqual(["*.ts", "*.tsx"]);
    });

    test("returns empty array for null/undefined globs", () => {
      const raw = `---
description: test
---
body`;

      const result = parseMdc(raw);
      expect(result.frontmatter.globs).toEqual([]);
    });

    test("returns empty array for invalid globs type", () => {
      const raw = `---
globs: 42
---
body`;

      const result = parseMdc(raw);
      expect(result.frontmatter.globs).toEqual([]);
    });
  });

  describe("alwaysApply normalization", () => {
    test("handles true boolean", () => {
      const raw = `---
alwaysApply: true
---
body`;
      expect(parseMdc(raw).frontmatter.alwaysApply).toBe(true);
    });

    test("handles false boolean", () => {
      const raw = `---
alwaysApply: false
---
body`;
      expect(parseMdc(raw).frontmatter.alwaysApply).toBe(false);
    });

    test("defaults to false when missing", () => {
      const raw = `---
description: test
---
body`;
      expect(parseMdc(raw).frontmatter.alwaysApply).toBe(false);
    });

    test("handles string 'true'", () => {
      const raw = `---
alwaysApply: "true"
---
body`;
      expect(parseMdc(raw).frontmatter.alwaysApply).toBe(true);
    });

    test("handles string 'false'", () => {
      const raw = `---
alwaysApply: "false"
---
body`;
      expect(parseMdc(raw).frontmatter.alwaysApply).toBe(false);
    });
  });

  describe("description normalization", () => {
    test("handles valid string description", () => {
      const raw = `---
description: "A helpful rule"
---
body`;
      expect(parseMdc(raw).frontmatter.description).toBe("A helpful rule");
    });

    test("returns undefined for empty string", () => {
      const raw = `---
description: ""
---
body`;
      expect(parseMdc(raw).frontmatter.description).toBeUndefined();
    });

    test("coerces number to string", () => {
      const raw = `---
description: 42
---
body`;
      expect(parseMdc(raw).frontmatter.description).toBe("42");
    });

    test("returns undefined when not present", () => {
      const raw = `---
globs: "*.ts"
---
body`;
      expect(parseMdc(raw).frontmatter.description).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    test("handles Windows-style line endings (CRLF)", () => {
      const raw = '---\r\ndescription: test\r\nglobs: "*.ts"\r\n---\r\nBody content.';
      const result = parseMdc(raw);

      expect(result.frontmatter.description).toBe("test");
      expect(result.frontmatter.globs).toEqual(["*.ts"]);
      expect(result.body.trim()).toBe("Body content.");
    });

    test("handles frontmatter with extra whitespace", () => {
      const raw = `---
description:   "  spaced description  "  
globs: "*.ts"
---
body`;

      const result = parseMdc(raw);
      expect(result.frontmatter.description).toBe("  spaced description  ");
    });

    test("handles body with --- in content (not frontmatter)", () => {
      const raw = `---
description: test
---

Some content.

---

More content after horizontal rule.`;

      const result = parseMdc(raw);
      expect(result.frontmatter.description).toBe("test");
      expect(result.body).toContain("---");
      expect(result.body).toContain("More content after horizontal rule.");
    });

    test("handles very long content efficiently", () => {
      const longBody = "x".repeat(100_000);
      const raw = `---
description: big rule
---
${longBody}`;

      const start = performance.now();
      const result = parseMdc(raw);
      const elapsed = performance.now() - start;

      expect(result.frontmatter.description).toBe("big rule");
      expect(result.body.trim().length).toBe(100_000);
      expect(elapsed).toBeLessThan(50); // Should be very fast
    });

    test("handles content that looks like frontmatter but isn't at the start", () => {
      const raw = `Some text first.

---
description: not frontmatter
---

More text.`;

      const result = parseMdc(raw);
      expect(result.frontmatter.description).toBeUndefined();
      expect(result.body).toBe(raw);
    });
  });
});
