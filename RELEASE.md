# Release Process

This project uses [Release Please](https://github.com/googleapis/release-please) for automated changelog generation and GitHub/npm releases.

## How Release Please Works

Release Please automates the release process by:

1. **Analyzing Conventional Commits**: Scans your commit history for [Conventional Commits](https://www.conventionalcommits.org/)
2. **Creating Release PRs**: Automatically creates a release pull request when changes are detected
3. **Generating Changelogs**: Builds changelog entries based on commit types
4. **Version Bumping**: Determines the next version number (major/minor/patch) based on commit types

### Commit Types and Version Impact

- `feat:` - New feature → **Minor** version bump
- `fix:` - Bug fix → **Patch** version bump
- `docs:` - Documentation changes → No version bump
- `style:` - Code style changes → No version bump
- `refactor:` - Code refactoring → No version bump
- `perf:` - Performance improvements → **Patch** version bump
- `test:` - Test changes → No version bump
- `chore:` - Maintenance tasks → No version bump
- `BREAKING CHANGE:` in footer or `!` after type → **Major** version bump

## Setup

### 1. GitHub Token

Create a GitHub personal access token with `repo` scope permissions:

1. Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Select scopes: `repo` (full control of private repositories)
4. Copy the token

### 2. Environment Configuration

Copy the example environment file and add your token:

```bash
cp .env.example .env
# Edit .env and add your GITHUB_TOKEN
```

Or set it directly in your shell:

```bash
export GITHUB_TOKEN=your_github_token_here
```

## Making Releases

### Manual Release (Local)

To create a release pull request manually:

```bash
# Ensure GITHUB_TOKEN is set
export GITHUB_TOKEN=your_github_token_here

# Dry run (preview what would happen)
npx release-please release-pr --dry-run

# Create the actual release PR
npm run release
```

### GitHub Actions (Recommended)

For fully automated releases, set up a GitHub Actions workflow:

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    branches:
      - main

permissions:
  contents: write
  pull-requests: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          release-type: node
```

This will automatically create release PRs whenever you push to main.

## Release Workflow

### Step 1: Merge Changes

Developers make changes with conventional commits:

```bash
git commit -m "feat: add new rule validation"
git commit -m "fix: resolve glob pattern matching issue"
git commit -m "docs: update README with examples"
```

### Step 2: Release PR Created

Release Please creates a PR that includes:
- Updated `CHANGELOG.md`
- Version bump in `package.json`
- Updated `.release-please-manifest.json`

### Step 3: Review and Merge

1. Review the release PR
2. Ensure the changelog and version look correct
3. Merge the PR

### Step 4: Tag and Release

Once the release PR is merged:
- A Git tag is created (e.g., `v1.1.0`)
- A GitHub Release is published with release notes
- npm publish can be triggered (if configured)

## Example Commands

### Check current status (dry run)

```bash
npx release-please release-pr --dry-run
```

### Create release PR manually

```bash
npm run release
```

### Force a specific version

```bash
npx release-please release-pr --release-as=minor
npx release-please release-pr --release-as=1.2.0
```

### Skip GitHub release (just tag)

```bash
npx release-please release-pr --skip-github-release
```

## Configuration Files

- **release-please-config.json**: Main configuration for Release Please
- **.release-please-manifest.json**: Tracks current versions
- **package.json**: Standard npm package metadata

## Troubleshooting

### Token Issues

If you get authentication errors:
- Ensure `GITHUB_TOKEN` is set and exported
- Verify the token has `repo` scope
- Check that the token hasn't expired

### No Release PR Created

- Ensure commits follow conventional commit format
- Check that there are unreleased changes since the last tag
- Verify `.release-please-manifest.json` has correct version

### Version Mismatch

If the version is wrong:
- Manually update `.release-please-manifest.json`
- Delete and recreate the release PR

## References

- [Release Please Documentation](https://github.com/googleapis/release-please)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Semantic Versioning](https://semver.org/)
