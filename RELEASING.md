# Releasing kajji

Releases are driven by GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)). The flow has three stages, each in its own workflow run, gated on a manual review of a release PR.

```
workflow_dispatch  ──►  draft-release-pr  ──►  PR opened  ──►  human review/merge
                                                                         │
                                                  ┌──────────────────────┘
                                                  ▼
                                          tag-on-merge  ──►  push tag vX.Y.Z
                                                                         │
                                                  ┌──────────────────────┘
                                                  ▼
                                          build (×4 platforms)  ──►  publish (npm + GH release)
```

## Cutting a release

1. Open https://github.com/eliaskc/kajji/actions/workflows/release.yml
2. Click **Run workflow** on `main` and fill the inputs:
   - **bump**: `patch`, `minor`, `major`, an explicit `x.y.z`, or **leave empty** to let the agent decide based on commits since the last tag.
   - **model**: pi model id. Default is `opencode/claude-sonnet-4-6` (OpenCode Zen). Any pi-supported model works as long as the matching API key is in repo secrets. See *Model selection* below.
   - **pi_version**: pin a specific `@mariozechner/pi-coding-agent` version, or leave as `latest`.
3. Wait ~1–2 minutes. The `draft-release-pr` job runs `pi` against [`.github/workflows/release-notes-prompt.md`](.github/workflows/release-notes-prompt.md), which:
   - reads commits since the last tag (with progressive context-gathering via `git show` / `gh pr view`)
   - decides the bump (if not specified)
   - prepends a section to `CHANGELOG.md` and bumps `package.json`
   - is **not** allowed to commit, push, tag, or open PRs — the workflow does that programmatically
4. The job opens a PR titled `release: vX.Y.Z` with the `release` label and posts the generated notes in the PR body.
5. **Review the PR.** Edit `CHANGELOG.md` directly on the branch if the agent's wording, categorisation, or version bump is off. The PR is pretty printable.
6. **Merge the PR** (squash or merge — both work). The `release` label is what triggers the rest.
7. The `tag-on-merge` job creates and pushes `vX.Y.Z` from the merge commit.
8. The tag push triggers:
   - `build` matrix on native runners (darwin-arm64, darwin-x64, linux-x64, linux-arm64) — no cross-compile flakiness
   - `publish` job downloads all artifacts, runs `script/publish.ts --skip-build` to push 5 packages (`kajji-{platform}` × 4 + `kajji` wrapper) to npm, then creates the GitHub release with archives and notes from `CHANGELOG.md`

## Required secrets

| Secret | Used by | Notes |
|---|---|---|
| `OPENCODE_API_KEY` | `draft-release-pr` | Get one at https://opencode.ai. If you switch models to a non-OpenCode provider, add the matching env var (e.g. `ANTHROPIC_API_KEY`) and update `release.yml` accordingly. |
| `NPM_TOKEN` | `publish` | Automation token with publish rights for `kajji`, `kajji-darwin-*`, `kajji-linux-*`. |
| `GITHUB_TOKEN` | all jobs | Auto-provided by Actions. Needs `contents: write` and `pull-requests: write` (set in workflow). |

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
bun run script/release.ts <version>   # version: patch | minor | major | x.y.z
```

This requires you to have all four target platforms buildable locally, which is the whole reason the CI flow exists.

## Troubleshooting

- **`draft-release-pr` failed during `pi` step.** The agent likely hit a constraint check (empty commit range, downgrade attempt, missing CHANGELOG section). Re-read the job logs — the verify step prints what's missing.
- **Agent picked the wrong bump.** Either re-run the workflow with `bump` set explicitly, or just edit `package.json` and `CHANGELOG.md` on the PR branch.
- **Agent edited unexpected files.** The workflow auto-reverts anything outside `package.json` / `CHANGELOG.md` and warns. If something useful was discarded, edit it back into the PR manually.
- **Tag pushed but `publish` didn't run.** Check the `build` matrix — `publish` needs all four platforms green. If a runner is having a bad day, re-run failed jobs.
- **Wrapper `kajji` package failed to publish but platform packages succeeded.** `publish.ts` deliberately skips the wrapper if any platform publish failed (so users never get a broken `npm i kajji`). Fix the platform package(s) and re-run.
- **Need to re-publish the same version.** npm doesn't allow it. Bump to the next patch and ship again.
