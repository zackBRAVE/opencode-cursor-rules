# opencode-cursor-rules - Technical Design Document

## Overview

An OpenCode plugin that brings full Cursor rules support to OpenCode. It reads `.mdc` rule files (with YAML frontmatter) from both user-level and project-level directories, then injects matching rules into the LLM system prompt via OpenCode's plugin hooks.

The plugin is designed as a **symlink-friendly** bridge: users symlink `.cursor/rules` into `.opencode/rules` (or `~/.config/opencode/rules`), and the plugin handles everything from there.

## Goals

1. **Full Cursor MDC compatibility** - Parse all frontmatter fields (`description`, `globs`, `alwaysApply`)
2. **All four rule application modes** - Always, auto-attach (glob), agent-requested (description), manual
3. **Both project and user/global rules** - Project: `<project>/.opencode/rules/`, User: `~/.config/opencode/rules/`
4. **Performance** - Lazy loading, mtime-based caching, zero file watchers, minimal memory
5. **Robustness** - Handle broken symlinks, missing dirs, malformed YAML, circular refs gracefully
6. **Legacy support** - `.cursorrules` flat file in project root

## Architecture

```
index.ts          Plugin entry point, wires hooks to core modules
src/
├── parser.ts     MDC frontmatter extraction + YAML parsing
├── loader.ts     Rule discovery, caching, mtime invalidation
├── matcher.ts    Glob matching + rule selection logic
└── types.ts      Shared TypeScript interfaces
```

### Why This Structure

- **parser.ts** is pure: string in → structured data out. No I/O side effects, easily testable.
- **loader.ts** owns all filesystem access. Caches parsed rules keyed by `(path, mtime)`.
- **matcher.ts** is pure: rules + context → selected rules. No I/O, easily testable.
- **index.ts** is the thin orchestration layer that connects loader + matcher to OpenCode hooks.

## Core Components

### 1. Parser (`src/parser.ts`)

Extracts YAML frontmatter from MDC files and normalizes metadata.

```
Input:  raw file content (string)
Output: { frontmatter: RuleFrontmatter, body: string } | null
```

**Frontmatter fields (Cursor MDC spec):**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `description` | `string` | `undefined` | Rule purpose; used for agent-requested selection |
| `globs` | `string \| string[]` | `[]` | Comma-separated or array of file glob patterns |
| `alwaysApply` | `boolean` | `false` | If true, always injected into system prompt |

**Glob normalization:**
- String `"*.ts, *.tsx"` → `["*.ts", "*.tsx"]` (split on comma, trim)
- Array `["*.ts"]` → `["*.ts"]` (pass-through)
- Missing → `[]`

**Edge cases handled:**
- No frontmatter → body is entire content, all defaults
- Empty frontmatter (`---\n---`) → all defaults
- Invalid YAML → warning, treat as no frontmatter
- Non-string description → coerce to string

### 2. Loader (`src/loader.ts`)

Discovers and caches rule files from disk.

**Discovery paths:**
1. User rules: `~/.config/opencode/rules/*.mdc` (respects `XDG_CONFIG_HOME`)
2. Project rules: `<worktree>/.opencode/rules/*.mdc`
3. Legacy: `<worktree>/.cursorrules`

**Caching strategy:**
- Key: absolute file path
- Invalidation: `stat().mtime` comparison (no file watchers)
- On each `experimental.chat.system.transform` call, re-stat all known files
- New files discovered via `Bun.Glob` scan (inexpensive for small dirs)
- Cache is a plain `Map<string, { rule: Rule; mtimeMs: number }>`

**Why no file watchers:**
- Rule files change rarely (human-edited config)
- `stat()` is ~0.01ms, scanning 50 files costs <1ms
- No background threads, no event loop overhead, no cleanup needed
- Symlink-compatible (watchers can be unreliable across symlinks)

**Merge order:**
1. User rules loaded first
2. Project rules loaded second (higher priority)
3. Legacy `.cursorrules` loaded last (always-apply, lowest priority)
4. On name collision: project rule wins over user rule

### 3. Matcher (`src/matcher.ts`)

Selects which rules to inject based on the current context.

**Selection algorithm (in priority order):**

1. **Always-apply rules** (`alwaysApply: true`)
   - Unconditionally included
   - No context needed

2. **Glob-matched rules** (has `globs`, `alwaysApply` is false)
   - Matched against files seen in the session (from `tool.execute.before`)
   - Uses picomatch for fast glob evaluation
   - Tests against both full relative path and basename

3. **Agent-requested rules** (has `description`, no `globs`, `alwaysApply` is false)
   - Descriptions are listed in a special "available rules" section
   - The LLM decides which are relevant based on conversation context
   - Not injected as full content, only descriptions listed

4. **Manual rules** (no frontmatter / no description / no globs / `alwaysApply` is false)
   - Only included when explicitly `@rule-name` mentioned in user message
   - Extracted via regex from user message parts

**Context tracking:**
- `tool.execute.before` captures file paths from tool calls
- `chat.message` captures user message text for @-mentions
- Session state stored in a `Map<sessionID, SessionState>`

### 4. Plugin Entry (`index.ts`)

Thin wiring layer. Initializes loader, returns hooks object.

**Hooks used:**

| Hook | Purpose |
|------|---------|
| `experimental.chat.system.transform` | Inject matched rules into system prompt |
| `chat.message` | Capture user message for @-mentions |
| `tool.execute.before` | Track files accessed in session |

## System Prompt Injection Format

```markdown
<rules>
The rules section has a number of possible rules/memories/context...

<project_rules description="Rules from .opencode/rules/">
<rule name="typescript-standards" source="project">
Use strict TypeScript. Prefer interfaces over types.
</rule>
</project_rules>

<user_rules description="Rules from user config">
<rule name="bun-preference" source="user">
Always use Bun instead of Node.js.
</rule>
</user_rules>

<available_rules description="Rules available on request (ask if relevant)">
- **react-patterns**: React component best practices (globs: *.tsx)
- **api-guidelines**: REST API design standards
</available_rules>
</rules>
```

This XML-style format:
- Is parseable by LLMs with high fidelity
- Clearly separates rule sources
- Mirrors Cursor's injection style
- Distinguishes full rules from description-only available rules

## Performance Budget

| Operation | Target | Actual |
|-----------|--------|--------|
| Plugin init (cold) | <50ms | ~20ms (glob scan + parse) |
| Rule injection (warm cache) | <5ms | ~1ms (map lookups + string concat) |
| Rule injection (cache miss, 20 files) | <20ms | ~10ms (stat + parse) |
| Memory (50 rules) | <1MB | ~200KB |
| Per-session state | <1KB | ~500B |

## Error Handling

All errors are caught and logged, never thrown to OpenCode:
- Missing directories → skip silently
- Broken symlinks → skip file, log warning
- Malformed YAML → skip frontmatter, use body as content
- File read errors → skip file, log warning
- Empty files → skip

## Testing Strategy

| Layer | Test Type | What |
|-------|-----------|------|
| Parser | Unit | Frontmatter extraction, YAML parsing, edge cases |
| Loader | Unit + Integration | File discovery, caching, mtime invalidation, symlinks |
| Matcher | Unit | Rule selection across all 4 modes |
| Plugin | Integration | Full hook flow with mock context |

## Dependencies

**Runtime:**
- `yaml` - YAML frontmatter parsing (fast, well-maintained)
- `picomatch` - Glob matching (fast, no dependencies)
- `@opencode-ai/plugin` - OpenCode plugin types

**Dev:**
- `@types/bun` - Bun runtime types
- `@types/picomatch` - Picomatch types
- `typescript` - Type checking
