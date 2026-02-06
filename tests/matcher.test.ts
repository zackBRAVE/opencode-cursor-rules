import { describe, test, expect } from "bun:test";
import {
  getRuleMode,
  selectRules,
  formatSystemPromptSection,
} from "../src/matcher";
import type { Rule, SessionState, MatchedRule } from "../src/types";

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    name: "test-rule",
    sourcePath: "/path/to/test-rule.mdc",
    source: "project",
    frontmatter: {
      globs: [],
      alwaysApply: false,
      ...overrides.frontmatter,
    },
    body: "Test rule content.",
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    filePaths: new Set(),
    lastUserMessage: "",
    ...overrides,
  };
}

describe("getRuleMode", () => {
  test("returns 'always' when alwaysApply is true", () => {
    const rule = makeRule({
      frontmatter: { alwaysApply: true, globs: [], description: "test" },
    });
    expect(getRuleMode(rule)).toBe("always");
  });

  test("returns 'always' even with globs when alwaysApply is true", () => {
    const rule = makeRule({
      frontmatter: { alwaysApply: true, globs: ["*.ts"], description: "test" },
    });
    expect(getRuleMode(rule)).toBe("always");
  });

  test("returns 'glob' when has globs and alwaysApply is false", () => {
    const rule = makeRule({
      frontmatter: { alwaysApply: false, globs: ["*.ts"] },
    });
    expect(getRuleMode(rule)).toBe("glob");
  });

  test("returns 'agent' when has description only", () => {
    const rule = makeRule({
      frontmatter: {
        alwaysApply: false,
        globs: [],
        description: "A helpful rule",
      },
    });
    expect(getRuleMode(rule)).toBe("agent");
  });

  test("returns 'manual' when no description, no globs, not alwaysApply", () => {
    const rule = makeRule({
      frontmatter: { alwaysApply: false, globs: [] },
    });
    expect(getRuleMode(rule)).toBe("manual");
  });
});

describe("selectRules", () => {
  describe("always-apply rules", () => {
    test("always includes alwaysApply rules in injected", () => {
      const rules = [
        makeRule({
          name: "always-rule",
          frontmatter: { alwaysApply: true, globs: [] },
        }),
      ];
      const session = makeSession();

      const { injected } = selectRules(rules, session);
      expect(injected.length).toBe(1);
      expect(injected[0]!.rule.name).toBe("always-rule");
      expect(injected[0]!.reason).toBe("alwaysApply: true");
    });

    test("includes multiple always-apply rules", () => {
      const rules = [
        makeRule({ name: "a1", frontmatter: { alwaysApply: true, globs: [] } }),
        makeRule({ name: "a2", frontmatter: { alwaysApply: true, globs: [] } }),
      ];
      const session = makeSession();

      const { injected } = selectRules(rules, session);
      expect(injected.length).toBe(2);
    });
  });

  describe("glob-based rules", () => {
    test("puts glob-matched rules in suggested (not injected)", () => {
      const rules = [
        makeRule({
          name: "ts-rule",
          frontmatter: { alwaysApply: false, globs: ["*.ts"] },
        }),
      ];
      const session = makeSession({ filePaths: new Set(["src/index.ts"]) });

      const { injected, suggested } = selectRules(rules, session);
      expect(injected.length).toBe(0);
      expect(suggested.length).toBe(1);
      expect(suggested[0]!.rule.name).toBe("ts-rule");
    });

    test("does not suggest when no files match glob", () => {
      const rules = [
        makeRule({
          name: "ts-rule",
          frontmatter: { alwaysApply: false, globs: ["*.ts"] },
        }),
      ];
      const session = makeSession({ filePaths: new Set(["style.css"]) });

      const { suggested } = selectRules(rules, session);
      expect(suggested.length).toBe(0);
    });

    test("matches directory glob patterns", () => {
      const rules = [
        makeRule({
          name: "component-rule",
          frontmatter: {
            alwaysApply: false,
            globs: ["src/components/**/*.tsx"],
          },
        }),
      ];
      const session = makeSession({
        filePaths: new Set(["src/components/Button/Button.tsx"]),
      });

      const { suggested } = selectRules(rules, session);
      expect(suggested.length).toBe(1);
    });

    test("matches multiple globs (any match is sufficient)", () => {
      const rules = [
        makeRule({
          name: "multi-glob",
          frontmatter: { alwaysApply: false, globs: ["*.ts", "*.tsx", "*.js"] },
        }),
      ];
      const session = makeSession({ filePaths: new Set(["App.tsx"]) });

      const { suggested } = selectRules(rules, session);
      expect(suggested.length).toBe(1);
    });

    test("does not suggest when session has no files", () => {
      const rules = [
        makeRule({
          name: "ts-rule",
          frontmatter: { alwaysApply: false, globs: ["*.ts"] },
        }),
      ];
      const session = makeSession();

      const { suggested } = selectRules(rules, session);
      expect(suggested.length).toBe(0);
    });
  });

  describe("agent-requested rules", () => {
    test("lists description-only rules as available", () => {
      const rules = [
        makeRule({
          name: "agent-rule",
          frontmatter: {
            alwaysApply: false,
            globs: [],
            description: "REST API guidelines",
          },
        }),
      ];
      const session = makeSession();

      const { injected, suggested, available } = selectRules(rules, session);
      expect(injected.length).toBe(0);
      expect(suggested.length).toBe(0);
      expect(available.length).toBe(1);
      expect(available[0]!.name).toBe("agent-rule");
    });
  });

  describe("manual rules (@-mention)", () => {
    test("injects rule when @-mentioned in user message", () => {
      const rules = [
        makeRule({
          name: "manual-rule",
          frontmatter: { alwaysApply: false, globs: [] },
        }),
      ];
      const session = makeSession({
        lastUserMessage: "Please follow @manual-rule for this task",
      });

      const { injected } = selectRules(rules, session);
      expect(injected.length).toBe(1);
      expect(injected[0]!.reason).toBe("@mentioned by user");
    });

    test("does not inject manual rule without @-mention", () => {
      const rules = [
        makeRule({
          name: "manual-rule",
          frontmatter: { alwaysApply: false, globs: [] },
        }),
      ];
      const session = makeSession({ lastUserMessage: "Do some work" });

      const { injected } = selectRules(rules, session);
      expect(injected.length).toBe(0);
    });

    test("@-mention can inject any rule mode (overrides)", () => {
      const rules = [
        makeRule({
          name: "agent-rule",
          frontmatter: {
            alwaysApply: false,
            globs: [],
            description: "API rules",
          },
        }),
      ];
      const session = makeSession({
        lastUserMessage: "Use @agent-rule for this",
      });

      const { injected } = selectRules(rules, session);
      expect(injected.length).toBe(1);
      expect(injected[0]!.rule.name).toBe("agent-rule");
    });

    test("@-mention overrides glob rules to inject", () => {
      const rules = [
        makeRule({
          name: "ts-rule",
          frontmatter: { alwaysApply: false, globs: ["*.ts"] },
        }),
      ];
      const session = makeSession({
        lastUserMessage: "Use @ts-rule now",
      });

      // @-mentioned: goes to injected (not suggested)
      const { injected, suggested } = selectRules(rules, session);
      expect(injected.length).toBe(1);
      expect(suggested.length).toBe(0);
    });

    test("handles multiple @-mentions", () => {
      const rules = [
        makeRule({
          name: "rule-a",
          frontmatter: { alwaysApply: false, globs: [] },
        }),
        makeRule({
          name: "rule-b",
          frontmatter: { alwaysApply: false, globs: [] },
        }),
      ];
      const session = makeSession({
        lastUserMessage: "Follow @rule-a and @rule-b",
      });

      const { injected } = selectRules(rules, session);
      expect(injected.length).toBe(2);
    });

    test("ignores @-mention for non-existent rules", () => {
      const rules = [
        makeRule({
          name: "real-rule",
          frontmatter: { alwaysApply: false, globs: [] },
        }),
      ];
      const session = makeSession({
        lastUserMessage: "Use @non-existent-rule",
      });

      const { injected } = selectRules(rules, session);
      expect(injected.length).toBe(0);
    });
  });

  describe("deduplication", () => {
    test("does not duplicate a rule that matches multiple modes", () => {
      const rules = [
        makeRule({
          name: "multi-match",
          frontmatter: { alwaysApply: true, globs: ["*.ts"] },
        }),
      ];
      const session = makeSession({
        filePaths: new Set(["app.ts"]),
        lastUserMessage: "Use @multi-match",
      });

      // @-mention wins, appears in injected once
      const { injected, suggested } = selectRules(rules, session);
      expect(injected.length).toBe(1);
      expect(suggested.length).toBe(0);
    });
  });

  describe("mixed rules — all modes together", () => {
    test("correctly categorizes all rule types", () => {
      const rules = [
        makeRule({
          name: "always",
          frontmatter: { alwaysApply: true, globs: [] },
        }),
        makeRule({
          name: "ts-glob",
          frontmatter: { alwaysApply: false, globs: ["*.ts"] },
        }),
        makeRule({
          name: "css-glob",
          frontmatter: { alwaysApply: false, globs: ["*.css"] },
        }),
        makeRule({
          name: "agent-desc",
          frontmatter: {
            alwaysApply: false,
            globs: [],
            description: "API patterns",
          },
        }),
        makeRule({
          name: "manual-only",
          frontmatter: { alwaysApply: false, globs: [] },
        }),
      ];

      const session = makeSession({
        filePaths: new Set(["src/app.ts"]),
        lastUserMessage: "Help me out",
      });

      const { injected, suggested, available } = selectRules(rules, session);

      // always → injected
      expect(injected.length).toBe(1);
      expect(injected[0]!.rule.name).toBe("always");

      // ts-glob → suggested (css-glob not matched)
      expect(suggested.length).toBe(1);
      expect(suggested[0]!.rule.name).toBe("ts-glob");

      // agent-desc → available
      expect(available.length).toBe(1);
      expect(available[0]!.name).toBe("agent-desc");

      // manual-only → nowhere (not @-mentioned)
    });
  });
});

describe("formatSystemPromptSection", () => {
  test("returns empty string when no rules at all", () => {
    const result = formatSystemPromptSection([], [], []);
    expect(result).toBe("");
  });

  test("formats injected project rules with full content", () => {
    const injected: MatchedRule[] = [
      {
        rule: makeRule({
          name: "ts-standards",
          source: "project",
          frontmatter: {
            alwaysApply: true,
            globs: [],
            description: "TypeScript standards",
          },
          body: "Use strict mode.",
        }),
        reason: "alwaysApply: true",
      },
    ];

    const result = formatSystemPromptSection(injected, [], []);

    expect(result).toContain("<rules>");
    expect(result).toContain("</rules>");
    expect(result).toContain("<project_rules");
    expect(result).toContain("ts-standards");
    expect(result).toContain("Use strict mode.");
  });

  test("formats injected user rules with full content", () => {
    const injected: MatchedRule[] = [
      {
        rule: makeRule({
          name: "user-pref",
          source: "user",
          body: "Prefer Bun over Node.",
        }),
        reason: "alwaysApply: true",
      },
    ];

    const result = formatSystemPromptSection(injected, [], []);

    expect(result).toContain("<user_rules");
    expect(result).toContain("Prefer Bun over Node.");
  });

  test("formats suggested rules with path (no full content)", () => {
    const suggested: MatchedRule[] = [
      {
        rule: makeRule({
          name: "ts-patterns",
          sourcePath: "/project/.opencode/rules/ts-patterns.mdc",
          frontmatter: {
            alwaysApply: false,
            globs: ["*.ts"],
            description: "TS patterns",
          },
          body: "This should NOT appear in output.",
        }),
        reason: "glob match: *.ts → src/app.ts",
      },
    ];

    const result = formatSystemPromptSection([], suggested, []);

    expect(result).toContain("<suggested_rules");
    expect(result).toContain("ts-patterns");
    expect(result).toContain("/project/.opencode/rules/ts-patterns.mdc");
    expect(result).toContain("glob match");
    // Full body should NOT be included
    expect(result).not.toContain("This should NOT appear in output.");
  });

  test("formats available rules with path (no full content)", () => {
    const available = [
      makeRule({
        name: "react-patterns",
        sourcePath: "/project/.opencode/rules/react-patterns.mdc",
        frontmatter: {
          alwaysApply: false,
          globs: [],
          description: "React best practices",
        },
      }),
    ];

    const result = formatSystemPromptSection([], [], available);

    expect(result).toContain("<available_rules");
    expect(result).toContain("react-patterns");
    expect(result).toContain("React best practices");
    expect(result).toContain("/project/.opencode/rules/react-patterns.mdc");
  });

  test("separates project and user injected rules in output", () => {
    const injected: MatchedRule[] = [
      {
        rule: makeRule({
          name: "user-rule",
          source: "user",
          body: "User content.",
        }),
        reason: "test",
      },
      {
        rule: makeRule({
          name: "proj-rule",
          source: "project",
          body: "Project content.",
        }),
        reason: "test",
      },
    ];

    const result = formatSystemPromptSection(injected, [], []);

    expect(result).toContain("<user_rules");
    expect(result).toContain("<project_rules");
    const userIdx = result.indexOf("<user_rules");
    const projIdx = result.indexOf("<project_rules");
    expect(userIdx).toBeLessThan(projIdx);
  });

  test("includes all three tiers when all present", () => {
    const injected: MatchedRule[] = [
      {
        rule: makeRule({
          name: "always-rule",
          source: "project",
          frontmatter: { alwaysApply: true, globs: [] },
          body: "Always content.",
        }),
        reason: "alwaysApply: true",
      },
    ];
    const suggested: MatchedRule[] = [
      {
        rule: makeRule({
          name: "glob-rule",
          sourcePath: "/p/rules/glob-rule.mdc",
          frontmatter: { alwaysApply: false, globs: ["*.ts"] },
        }),
        reason: "glob match",
      },
    ];
    const available = [
      makeRule({
        name: "desc-rule",
        sourcePath: "/p/rules/desc-rule.mdc",
        frontmatter: {
          alwaysApply: false,
          globs: [],
          description: "Some description",
        },
      }),
    ];

    const result = formatSystemPromptSection(injected, suggested, available);

    expect(result).toContain("<project_rules");
    expect(result).toContain("Always content.");
    expect(result).toContain("<suggested_rules");
    expect(result).toContain("glob-rule.mdc");
    expect(result).toContain("<available_rules");
    expect(result).toContain("desc-rule.mdc");
  });
});
