# 📋 opencode-cursor-rules

[![npm version](https://img.shields.io/npm/v/opencode-cursor-rules.svg)](https://www.npmjs.com/package/opencode-cursor-rules)
[![License MIT](https://img.shields.io/npm/l/opencode-cursor-rules.svg)](https://opensource.org/licenses/MIT)

Bring **full Cursor rules support** to OpenCode. This plugin reads `.mdc` rule files and injects them into AI conversations -- exactly how Cursor does it.

**No config needed if you already use Cursor.** Just symlink your rules and you're done.

## Why opencode-cursor-rules?

- ✅ **100% Cursor-compatible** -- Same `.mdc` format, same frontmatter, same behavior
- ✅ **All 4 rule modes** -- always-apply, glob-matching, agent-requested, manual
- ✅ **Zero config** -- Works with your existing Cursor rules via symlinks
- ✅ **Blazing fast** -- mtime caching, no file watchers, sub-millisecond injection
- ✅ **Battle-tested** -- handles broken symlinks, malformed YAML, missing files gracefully
- ✅ **Rule management** -- Create and list rules via OpenCode tools

## Installation

```bash
# Install the package (recommended: pin to a specific version)
bun add opencode-cursor-rules@1.0.0

# Or with pnpm
pnpm add opencode-cursor-rules@1.0.0

# Or with npm
npm install opencode-cursor-rules@1.0.0
```

> ⚠️ **Tip:** Pin to a specific version (e.g., `@1.0.0`) to prevent automatic updates. OpenCode may reinstall plugins on every startup if no version is specified.

Then add it to your OpenCode config (`~/.config/opencode/opencode.jsonc`):

```jsonc
{
  "plugin": [
    "opencode-cursor-rules@1.0.0"
  ]
}
```

## Quick Start

### Option 1: Use Your Existing Cursor Rules (Recommended)

```bash
# Project-level rules
cd your-project
ln -s .cursor/rules .opencode/rules

# User-level rules (global)
ln -s ~/.cursor/rules ~/.config/opencode/rules
```

### Option 2: Create Rules Directly

```bash
mkdir -p .opencode/rules
```

Create `.mdc` files in the directory (see Rule Format below).

### Restart OpenCode

Rules load on plugin initialization. Start a new session after adding/changing rules.

## Rule Format

Rules use **MDC format** (Markdown + YAML frontmatter), identical to Cursor:

```markdown
---
description: "Brief description of what this rule does"
globs: "*.ts, *.tsx"
alwaysApply: false
---

Your rule content in Markdown.
This gets injected into the AI's system prompt.
```

### Frontmatter Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `description` | `string` | — | Rule purpose; shown to AI for agent-requested selection |
| `globs` | `string \| string[]` | `[]` | Comma-separated or array of file glob patterns |
| `alwaysApply` | `boolean` | `false` | Always inject this rule into every conversation |

### Rule Application Modes

| Mode | Frontmatter | Behavior |
|------|------------|----------|
| **Always** | `alwaysApply: true` | Injected into every conversation |
| **Auto-Attach** | `globs` defined | Injected when session files match patterns |
| **Agent-Requested** | `description` only (no globs) | Description listed; AI decides if relevant |
| **Manual** | No frontmatter | Only injected when user types `@rule-name` |

### Examples

**Always-apply rule:**

```markdown
---
description: "General coding standards"
alwaysApply: true
---

- Write clean, readable code
- Add JSDoc comments to exported functions
- Keep functions under 30 lines
```

**Glob-based rule:**

```markdown
---
description: "React component patterns"
globs: "*.tsx, src/components/**"
---

Use functional components with hooks.
Follow the container/presenter pattern.
Prefer composition over inheritance.
```

**Agent-requested rule:**

```markdown
---
description: "REST API design guidelines"
---

Use proper HTTP methods.
Version your APIs with /v1/ prefix.
Return consistent error response shapes.
```

**Manual rule:**

```markdown
# Legacy Migration Guide

When refactoring from v1 to v2:
1. Replace `useLegacyHook()` with `useNewHook()`
2. Update imports from `@/legacy` to `@/v2`
```

Trigger with: `@migration-guide help me migrate this file`

## Rule Priority

1. **Project rules** override **user rules** on name collision
2. **User rules** loaded first (lower priority)
3. **Legacy `.cursorrules`** loaded last (won't override named rules)
4. **@-mention** always promotes a rule to injected, regardless of its mode

## OpenCode Tools

The plugin provides tools for managing rules programmatically:

### `create_user_rule`

Create a new user-level rule in `~/.config/opencode/rules/`.

```typescript
{
  name: "typescript-standards",
  description: "TypeScript coding standards",
  content: "- Use strict TypeScript\n- Prefer interfaces over types",
  globs: ["*.ts", "*.tsx"],
  alwaysApply: false
}
```

### `create_project_rule`

Create a new project-level rule in `.opencode/rules/`. Same parameters plus optional `worktree` for custom directories.

### `list_rules`

List all loaded rules with metadata, sources, and application modes.

## Available Scripts

```bash
# Run tests
npm test

# Type check
npm run typecheck

# Run Biome checks
npm run lint          # Check for issues
npm run lint:fix      # Auto-fix issues
npm run format        # Check formatting
npm run format:fix    # Auto-fix formatting
npm run check         # Run all checks (types + lint + format)
npm run check:fix     # Auto-fix all issues
```

## Performance

| Operation | Time |
|-----------|------|
| Cold start (scan + parse 20 rules) | ~20ms |
| Warm injection (cached rules) | <1ms |
| Memory per 50 rules | ~200KB |

- **No file watchers** -- uses `stat()` mtime for cache invalidation
- **Lazy caching** -- files parsed once, re-parsed only on modification
- **Minimal runtime dependencies** -- only `yaml` and `picomatch`

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT
