# Releasing kajji

One GitHub Actions workflow, [`release.yml`](../.github/workflows/release.yml), prepares and publishes releases. Run it manually on `main` and select an **action**:

| Action | Result |
|---|---|
| `prepare-and-release` (default) | The agent drafts the version and notes. The workflow commits them to `main` and publishes. No review. |
| `prepare-pr` | The agent drafts the version and notes and opens a PR from `release/next` with the `release` label. Merging the PR publishes. |
| `release` | Publish the version in `package.json` on `main`. Use it after you prepare a release by hand, or to finish a failed release. |

**bump** (`auto`, `patch`, `minor`, `major`) applies to the two prepare actions. With `auto`, the agent decides.

```
propose ──► prepare-pr: open PR ──► merge PR (release label) ──► new run: verify ─┐
        └─► commit to main (after verify passes) ────────────────────────────────┤
release action ──────────────────────────────────────────────────────────────────┤
                                                                                 ▼
                    source ──► build (×4 platforms) ──► publish npm ──► tag vX.Y.Z ──► GH release ──► Homebrew
```

## Jobs

1. **`propose`** (prepare actions only):
   - `scripts/prepare-release.ts context` collects every commit since the latest `vX.Y.Z` tag (subject, body, changed files). It fails if there are no commits, or if `package.json` is ahead of the latest tag (a release is pending).
   - A pinned `pi` with read-only tools and no GitHub token reads [`.github/release-notes-prompt.md`](../.github/release-notes-prompt.md) and returns only `{ "version", "notes" }`.
   - The script validates the proposal: the version must be an allowed bump, the notes must use the `breaking`/`new`/`improved`/`fixed` sections in order, and commit links must point into the release range. With `auto`, a `0.x` release stays below `1.0.0`.
2. **`prepare-pr`**: applies the proposal on a fresh checkout and opens or updates the release PR. Edit `CHANGELOG.md` or `package.json` on the branch if necessary.
3. **`verify`**: `bun check`, `bun lint`, and the unit tests (`bun run test`, no E2E) with a pinned `jj`. For `prepare-and-release` it runs on the base commit at the same time as `propose`, so a failure does not leave a release commit on `main`.
4. **`commit`** (`prepare-and-release` only): applies the proposal and pushes `release: vX.Y.Z` to `main`. The push is not forced, so it fails if `main` moved during the run. Then run the workflow again.
5. **`source`**: resolves the commit and version, and checks that `CHANGELOG.md` has a section for the version. It fails if the tag already exists at a different commit.
6. **`build`**: compiles and smoke-tests (`kajji --version`) each binary on native runners (darwin-arm64, darwin-x64, linux-x64, linux-arm64).
7. **`publish`**: publishes the 5 npm packages, then tags the commit as `vX.Y.Z`, creates the GitHub release, and updates Homebrew. The tag is created only after npm publish succeeds.

## Recovery

Every publish step is safe to re-run: `publish.ts` skips package versions that already exist, the tag step accepts a tag that already points at the release commit, and the GitHub release step overwrites assets. After a partial failure, use **Re-run failed jobs**, or run the workflow with the `release` action.

A version that reached npm cannot be published again. To fix a bad release, merge the fix and prepare a new release.

## Configuration

| Name | Kind | Notes |
|---|---|---|
| `OPENCODE_API_KEY` | secret | Used by `propose` for the default model. `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are also passed through if you use those providers. |
| `HOMEBREW_TAP_TOKEN` | secret | Push access to `eliaskc/homebrew-tap`. |
| `RELEASE_PI_MODEL` | variable (optional) | `provider/model` for release notes. Default: `opencode/claude-opus-5-5`. |
| `RELEASE_PI_VERSION` | variable (optional) | Exact pi version. Default: the version pinned in `release.yml`. |

Bun and jj versions are pinned in the workflow `env` block (`BUN_VERSION`, `JJ_VERSION`).

`prepare-and-release` pushes to `main` with `GITHUB_TOKEN`. If you enable branch protection on `main`, allow GitHub Actions to bypass it, or use `prepare-pr`.

npm publishing uses OIDC trusted publishing instead of a repository secret. Configure GitHub Actions as the trusted publisher for each of `kajji`, `kajji-darwin-arm64`, `kajji-darwin-x64`, `kajji-linux-arm64`, and `kajji-linux-x64` with:

- Organization or user: `eliaskc`
- Repository: `kajji`
- Workflow filename: `release.yml`
- Allowed action: `npm publish`

## Verify after release

```bash
npm install -g kajji@<version>
kajji

curl -fsSL https://kajji.sh/install.sh | bash
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

## Local fallback

If GH Actions is down or you need to ship from your machine, the original local flow still works:

```bash
# 1. Generate changelog locally with Claude Code
/release-notes        # uses .claude/commands/release-notes.md (or .pi/prompts/release-notes.md via pi)

# 2. Review CHANGELOG.md, commit it
jj describe -m "release: vX.Y.Z"

# 3. Build, publish, tag, and create the GH release in one shot
bun run scripts/release.ts <version>   # version: patch | minor | major | x.y.z
```

This requires you to have all four target platforms buildable locally, which is the whole reason the CI flow exists.

## Troubleshooting

- **`propose` failed at "Collect release context".** Either there are no commits since the latest tag, or `package.json` is ahead of the latest tag. For the second case, run the `release` action to finish the pending release.
- **`propose` failed at "Validate proposal".** The agent returned an invalid proposal. The log shows the reason. Run again, set `bump` explicitly, or change `RELEASE_PI_MODEL`.
- **`commit` or `prepare-pr` failed with "Release context changed", or the push was rejected.** `main` moved during the run. Run the workflow again.
- **Wrong bump or wording after `prepare-and-release`.** Edit the GitHub release notes and `CHANGELOG.md` by hand. Use `prepare-pr` when you want to review first.
- **`publish` did not run.** It needs `verify` and all four builds to pass. Re-run failed jobs.
- **Wrapper `kajji` package failed to publish but platform packages succeeded.** `publish.ts` deliberately skips the wrapper if any platform publish failed (so users never get a broken `npm i kajji`). Fix the platform package(s) and re-run.
