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

OpenCode automatically installs plugins on startup. Simply add it to your config (`~/.config/opencode/opencode.jsonc`):

```jsonc
{
  "plugin": [
    "opencode-cursor-rules@1.0.0"
  ]
}
```

> ⚠️ **Important:** Always pin to a specific version (e.g., `@1.0.0`) to prevent breaking changes. OpenCode installs the latest version if no version is specified.

## Quick Start

### Option 1: Use Your Existing Cursor Rules (Recommended)

```bash
# Project-level rules
cd your-project
ln -s ../.cursor/rules .opencode/rules

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

- **OpenCode 1.x**: restart the CLI to reload plugins.
- **OpenCode 2.x**: plugin files are watched and hot-reloaded by the shared
  server; if a change does not apply, run `opencode service restart`.

## Compatibility

The plugin supports both host generations from a single codebase:

| Host | Entry point | Notes |
|------|-------------|-------|
| OpenCode 1.x | `server` export | v1 hooks (`chat.message`, `experimental.chat.system.transform`, `tool.execute.before`, `config` commands) run natively |
| OpenCode 2.x | `setup` export | v1 hooks are bridged into v2 registrations (`tool.transform`, `session.hook("context")`, `command.transform`) |

All features — rule loading, glob matching, `@rule-name` mentions, management
tools, slash commands, and the [opt-in loading](#opt-in-loading-opencode-v2)
flags — work identically on both hosts.

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

### Opt-In Loading (OpenCode v2)

By default (v2 adapter), **nothing is injected into the system prompt until the
session is explicitly initialized** — via the `list_rules` tool or the
`/use-cursor-rule` command. After the init, every mode above works as usual for
that session.

Two environment flags relax the gating (accept `1` or `true`):

| Flag | Effect when enabled |
|------|---------------------|
| `LOAD_ALWAYS_APPLY_RULES_ON_STARTUP` | `alwaysApply: true` rules inject from session start, no init needed |
| `LOAD_MENTION_RULES_WITHOUT_EXPLICIT_INIT` | Glob / description / `@rule-name` rules work from session start, no init needed |

Both flags off (default) = full opt-in: run `/use-cursor-rule` (or ask the agent
to call `list_rules`) to unlock rule loading for the current session.

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

List all loaded rules with metadata, sources, and application modes. Calling
this tool also counts as an explicit session init (see
[Opt-In Loading](#opt-in-loading-opencode-v2)).

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

## Release

Releases are created manually using GitHub CLI instead of automated Release Please due to GraphQL API authentication issues. See RELEASE.md for details.

## License

MIT
