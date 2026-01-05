# Releasing kajji

## Quick Release

```bash
/changelog                           # generate CHANGELOG.md
# review CHANGELOG.md
bun run script/release.ts [version]  # does everything else
```

## Step-by-Step

### 1. Generate changelog

Use the `/changelog` skill to generate release notes in CHANGELOG.md.

The skill will:
- Find commits since last tag
- Generate formatted release notes
- Prepend to CHANGELOG.md

### 2. Review

Edit CHANGELOG.md if needed.

### 3. Release

```bash
bun run script/release.ts [version]
```

Version can be: `patch`, `minor`, `major`, or explicit like `0.2.0`. Auto-detects from commits if not specified.

The script:
- Checks for uncommitted changes (exits if dirty)
- Checks HEAD matches origin/main
- Bumps version in package.json
- Commits package.json + CHANGELOG.md
- Creates git tag and pushes
- Builds binaries for all platforms
- Publishes to npm
- Creates GitHub release

## Verify

```bash
npm install -g kajji@<version>
kajji

curl -fsSL https://raw.githubusercontent.com/eliaskc/kajji/main/install.sh | bash
~/.kajji/bin/kajji
```

## Stats

```bash
curl -s https://api.npmjs.org/downloads/point/last-week/kajji | jq
curl -s https://api.npmjs.org/downloads/point/last-month/kajji | jq
gh release view v<version> --json assets --jq '.assets[] | "\(.name): \(.downloadCount)"'
gh release list
```

**Web dashboards**:
- https://www.npmjs.com/package/kajji
- https://npm-stat.com/charts.html?package=kajji
