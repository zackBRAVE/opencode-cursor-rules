import { parse as parseYaml } from "yaml";
import type { RuleFrontmatter } from "./types";

/**
 * Result of parsing an MDC file's content string.
 */
export interface ParseResult {
  frontmatter: RuleFrontmatter;
  body: string;
}

const DEFAULTS: RuleFrontmatter = {
  globs: [],
  alwaysApply: false,
};

/**
 * Parse raw MDC file content into frontmatter + body.
 * Pure function: no I/O, no side effects.
 *
 * - If no frontmatter found, returns defaults with full content as body.
 * - If YAML is malformed, returns defaults with full content as body.
 * - Normalizes globs from string (comma-separated) or array to string[].
 */
export function parseMdc(raw: string): ParseResult {
  if (!raw || raw.length === 0) {
    return { frontmatter: { ...DEFAULTS }, body: "" };
  }

  const extracted = extractFrontmatter(raw);
  if (!extracted) {
    return { frontmatter: { ...DEFAULTS }, body: raw };
  }

  const { yamlStr, body } = extracted;

  // Empty frontmatter block (---\n---) → all defaults
  if (yamlStr.trim().length === 0) {
    return { frontmatter: { ...DEFAULTS }, body };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseYaml(yamlStr) as Record<string, unknown>;
  } catch {
    // Malformed YAML: treat entire content as body
    return { frontmatter: { ...DEFAULTS }, body: raw };
  }

  if (!parsed || typeof parsed !== "object") {
    return { frontmatter: { ...DEFAULTS }, body };
  }

  const frontmatter: RuleFrontmatter = {
    description: normalizeDescription(parsed.description),
    globs: normalizeGlobs(parsed.globs),
    alwaysApply: normalizeAlwaysApply(parsed.alwaysApply),
  };

  return { frontmatter, body };
}

/**
 * Extract YAML frontmatter from raw content.
 * Handles empty frontmatter, CRLF line endings, and --- in body content.
 *
 * Returns null if no valid frontmatter block found.
 */
function extractFrontmatter(raw: string): { yamlStr: string; body: string } | null {
  // Must start with ---
  if (!raw.startsWith("---")) return null;

  // Find end of first line (the opening ---)
  const firstNewline = raw.indexOf("\n");
  if (firstNewline === -1) return null;

  // Validate opening line is just --- (with optional \r and spaces)
  const openingLine = raw.slice(0, firstNewline).replace(/\r$/, "").trim();
  if (openingLine !== "---") return null;

  // Find closing --- on its own line
  const afterOpening = firstNewline + 1;
  const closingIdx = findClosingDelimiter(raw, afterOpening);
  if (closingIdx === -1) return null;

  const yamlStr = raw.slice(afterOpening, closingIdx);

  // Find start of body (after closing --- and its newline)
  const closingEnd = raw.indexOf("\n", closingIdx);
  const body = closingEnd === -1 ? "" : raw.slice(closingEnd + 1);

  return { yamlStr, body };
}

/**
 * Find the position of the closing --- delimiter.
 * It must be on its own line (only --- with optional \r and spaces).
 */
function findClosingDelimiter(raw: string, startPos: number): number {
  let pos = startPos;
  while (pos < raw.length) {
    // Find next newline or check if we're at start of a line
    const lineStart = pos;
    const nextNewline = raw.indexOf("\n", pos);
    const lineEnd = nextNewline === -1 ? raw.length : nextNewline;
    const line = raw.slice(lineStart, lineEnd).replace(/\r$/, "").trim();

    if (line === "---") {
      return lineStart;
    }

    if (nextNewline === -1) break;
    pos = nextNewline + 1;
  }
  return -1;
}

/**
 * Coerce description to string | undefined.
 */
function normalizeDescription(val: unknown): string | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "string") return val.length > 0 ? val : undefined;
  return String(val);
}

/**
 * Normalize globs from various input formats to string[].
 *
 * - string: split on comma, trim each
 * - string[]: filter to valid strings, trim each
 * - anything else: []
 */
function normalizeGlobs(val: unknown): string[] {
  if (val === undefined || val === null) return [];

  if (typeof val === "string") {
    return val
      .split(",")
      .map((g) => g.trim())
      .filter((g) => g.length > 0);
  }

  if (Array.isArray(val)) {
    return val
      .filter((g): g is string => typeof g === "string")
      .map((g) => g.trim())
      .filter((g) => g.length > 0);
  }

  return [];
}

/**
 * Normalize alwaysApply to boolean.
 */
function normalizeAlwaysApply(val: unknown): boolean {
  if (val === undefined || val === null) return false;
  if (typeof val === "boolean") return val;
  if (typeof val === "string") return val.toLowerCase() === "true";
  return false;
}
