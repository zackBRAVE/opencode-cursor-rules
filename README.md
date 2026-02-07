# opencode-cursor-rules

An OpenCode plugin that brings full **Cursor rules** (`.mdc` files) support to OpenCode. Symlink your `.cursor/rules` into `.opencode/rules` and everything just works -- frontmatter, globs, all four rule application modes.

## Features

- **Full MDC format support** -- YAML frontmatter with `description`, `globs`, `alwaysApply`
- **All 4 rule modes** -- always-apply, auto-attach (glob), agent-requested (description), manual (@mention)
- **Project + user-level rules** -- project rules in `.opencode/rules/`, global rules in `~/.config/opencode/rules/`
- **Symlink-friendly** -- symlink `.cursor/rules` → `.opencode/rules/` for zero-config Cursor compatibility
- **Legacy `.cursorrules` support** -- auto-detected and always applied
- **Performance-first** -- mtime-based caching, no file watchers, sub-millisecond warm-cache injection
- **Robust** -- handles missing dirs, broken symlinks, malformed YAML, empty files gracefully

## Quick Start

### 1. Install

Add to your OpenCode config (`~/.config/opencode/opencode.jsonc`):

```jsonc
{
  "plugin": [
    "opencode-cursor-rules@local:./custom-plugins/opencode-cursor-rules"
  ]
}
```

### 2. Set Up Rules

**Option A: Symlink from Cursor (recommended)**

```bash
# Project-level: symlink .cursor/rules to .opencode/rules
cd your-project
ln -s .cursor/rules .opencode/rules

# User-level: symlink global cursor rules
ln -s ~/.cursor/rules ~/.config/opencode/rules
```

**Option B: Create rules directly**

```bash
mkdir -p .opencode/rules
```

Then create `.mdc` files in the directory (see Rule Format below).

### 3. Restart OpenCode

Rules are loaded on plugin initialization. After adding/changing rules, restart OpenCode or start a new session.

## Rule Format

Rules use the **MDC format** (Markdown with YAML frontmatter), identical to Cursor:

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
| `description` | `string` | — | Rule purpose; shown to AI for agent-requested rules |
| `globs` | `string \| string[]` | `[]` | Comma-separated or array of file glob patterns |
| `alwaysApply` | `boolean` | `false` | Always inject this rule into every conversation |

### Rule Application Modes

How a rule gets applied depends on its frontmatter configuration:

| Mode | Frontmatter | Behavior |
|------|------------|----------|
| **Always** | `alwaysApply: true` | Injected into every conversation |
| **Auto-Attach** | `globs` defined | Injected when session files match patterns |
| **Agent-Requested** | `description` only (no globs) | Description listed; AI decides if relevant |
| **Manual** | No frontmatter | Only injected when user types `@rule-name` |

### Examples

**Always-apply rule** (`coding-standards.mdc`):

```markdown
---
description: "General coding standards"
alwaysApply: true
---

- Write clean, readable code
- Add JSDoc comments to exported functions
- Keep functions under 30 lines
```

**Glob-based rule** (`react-patterns.mdc`):

```markdown
---
description: "React component patterns"
globs: "*.tsx, src/components/**"
---

Use functional components with hooks.
Follow the container/presenter pattern.
Prefer composition over inheritance.
```

**Agent-requested rule** (`api-design.mdc`):

```markdown
---
description: "REST API design guidelines"
---

Use proper HTTP methods.
Version your APIs with /v1/ prefix.
Return consistent error response shapes.
```

**Manual rule** (`migration-guide.mdc`):

```markdown
# Legacy Migration Guide

When refactoring from v1 to v2:
1. Replace `useLegacyHook()` with `useNewHook()`
2. Update imports from `@/legacy` to `@/v2`
```

Trigger with: `@migration-guide help me migrate this file`

## Directory Structure

```
~/.config/opencode/
├── opencode.jsonc          # Plugin config
├── rules/                  # User-level rules (global)
│   └── *.mdc
└── custom-plugins/
    └── opencode-cursor-rules/   # This plugin
        ├── index.ts
        └── src/
            ├── parser.ts    # MDC frontmatter parsing
            ├── loader.ts    # File discovery + caching
            ├── matcher.ts   # Rule selection logic
            └── types.ts     # TypeScript interfaces

your-project/
├── .opencode/
│   └── rules/              # Project-level rules (symlink to .cursor/rules)
│       └── *.mdc
├── .cursor/
│   └── rules/              # Cursor rules (source of truth)
│       └── *.mdc
└── .cursorrules             # Legacy format (auto-detected)
```

## Rule Priority

1. **Project rules** override **user rules** on name collision
2. **User rules** loaded first (lower priority)
3. **Legacy `.cursorrules`** loaded last (won't override named rules)
4. **@-mention** always promotes a rule to injected, regardless of its mode

## Performance

| Operation | Time |
|-----------|------|
| Cold start (scan + parse 20 rules) | ~20ms |
| Warm injection (cached rules) | <1ms |
| Memory per 50 rules | ~200KB |

- **No file watchers** -- uses `stat()` mtime for cache invalidation
- **Lazy caching** -- files parsed once, re-parsed only on modification
- **Zero dependencies at runtime** beyond `yaml` and `picomatch`

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Run tests in watch mode
bun test --watch

# Type check
bun x tsc --noEmit

# Run both checks
bun run check
```

### Test Coverage

- **77 tests** across 4 test suites
- **Parser tests** -- frontmatter extraction, YAML edge cases, normalization
- **Loader tests** -- file discovery, caching, symlinks, broken links
- **Matcher tests** -- all 4 rule modes, deduplication, @-mentions
- **Integration tests** -- end-to-end pipeline, performance benchmarks

## Technical Design

See [DESIGN.md](./DESIGN.md) for the full technical design document.

## License

MIT
test change
