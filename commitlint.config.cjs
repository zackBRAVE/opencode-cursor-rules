module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Ensure type is one of the conventional commit types
    "type-enum": [
      2,
      "always",
      [
        "feat", // New feature
        "fix", // Bug fix
        "docs", // Documentation only changes
        "style", // Changes that do not affect the meaning of the code
        "refactor", // A code change that neither fixes a bug nor adds a feature
        "perf", // A code change that improves performance
        "test", // Adding missing tests or correcting existing tests
        "build", // Changes that affect the build system or external dependencies
        "ci", // Changes to CI configuration files and scripts
        "chore", // Other changes that don't modify src or test files
        "revert", // Reverts a previous commit
      ],
    ],
    // Type must be lowercase
    "type-case": [2, "always", "lower-case"],
    // Type is required
    "type-empty": [2, "never"],
    // Scope is optional but must be lowercase if provided
    "scope-case": [2, "always", "lower-case"],
    // Subject is required
    "subject-empty": [2, "never"],
    // Subject must not end with period
    "subject-full-stop": [2, "never", "."],
    // Subject case - allow any (flexible)
    "subject-case": [0],
    // Header max length
    "header-max-length": [2, "always", 100],
  },
};
