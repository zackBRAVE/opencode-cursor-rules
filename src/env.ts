/**
 * Environment flag parsing for opt-in rule loading.
 *
 * Flags accept "1" or "true" (case-insensitive); anything else (including
 * unset) is false.
 */

/** Allow always-apply rules to inject without explicit session init. */
export const ENV_LOAD_ALWAYS_APPLY_ON_STARTUP = "LOAD_ALWAYS_APPLY_RULES_ON_STARTUP";

/**
 * Allow non-always rules (glob / description / @mention) to load without
 * explicit session init.
 */
export const ENV_LOAD_MENTION_WITHOUT_INIT = "LOAD_MENTION_RULES_WITHOUT_EXPLICIT_INIT";

export function parseEnvFlag(name: string, raw: string | undefined = process.env[name]): boolean {
  if (!raw) return false;
  return raw === "1" || raw.toLowerCase() === "true";
}

export interface RuleLoadingFlags {
  loadAlwaysOnStartup: boolean;
  loadMentionWithoutInit: boolean;
}

export function readRuleLoadingFlags(
  env: Record<string, string | undefined> = process.env,
): RuleLoadingFlags {
  return {
    loadAlwaysOnStartup: parseEnvFlag(
      ENV_LOAD_ALWAYS_APPLY_ON_STARTUP,
      env[ENV_LOAD_ALWAYS_APPLY_ON_STARTUP],
    ),
    loadMentionWithoutInit: parseEnvFlag(
      ENV_LOAD_MENTION_WITHOUT_INIT,
      env[ENV_LOAD_MENTION_WITHOUT_INIT],
    ),
  };
}
