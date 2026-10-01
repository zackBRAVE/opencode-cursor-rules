import { describe, expect, test } from "bun:test";
import {
  ENV_LOAD_ALWAYS_APPLY_ON_STARTUP,
  ENV_LOAD_MENTION_WITHOUT_INIT,
  parseEnvFlag,
  readRuleLoadingFlags,
} from "../src/env";

describe("parseEnvFlag", () => {
  test.each([
    ["1", true],
    ["true", true],
    ["TRUE", true],
    ["True", true],
    ["0", false],
    ["false", false],
    ["yes", false],
    ["", false],
    [undefined, false],
  ])("parses %p as %p", (raw, expected) => {
    expect(parseEnvFlag("TEST_FLAG", raw)).toBe(expected);
  });
});

describe("readRuleLoadingFlags", () => {
  test("defaults to opt-in (both off) when env is unset", () => {
    expect(readRuleLoadingFlags({})).toEqual({
      loadAlwaysOnStartup: false,
      loadMentionWithoutInit: false,
    });
  });

  test("reads both flags from the provided env", () => {
    expect(
      readRuleLoadingFlags({
        [ENV_LOAD_ALWAYS_APPLY_ON_STARTUP]: "1",
        [ENV_LOAD_MENTION_WITHOUT_INIT]: "true",
      }),
    ).toEqual({
      loadAlwaysOnStartup: true,
      loadMentionWithoutInit: true,
    });
  });
});
