# Build & Release Flows

**Status**: Not started  
**Priority**: High (next up)

---

## Distribution Methods — Effort Analysis

| Method | Effort | One Publish? | Notes |
|--------|--------|--------------|-------|
| **npm** | LOW | ✅ Yes | Add `"bin"`, remove `"private"`, `npm publish` |
| **bunx** | FREE | ✅ (via npm) | Works automatically after npm publish |
| **npx** | FREE | ✅ (via npm) | Works automatically after npm publish |
| **pnpm** | FREE | ✅ (via npm) | `pnpm dlx lazyjuju` works automatically |
| **yarn** | FREE | ✅ (via npm) | `yarn dlx lazyjuju` works automatically |
| **Homebrew** | MEDIUM | ❌ No | Separate tap repo + formula + binary builds |
| **curl installer** | MEDIUM | ❌ No | Install script + binary hosting |

**Recommendation**: Start with npm publish. One action gives you npm/bunx/npx/pnpm/yarn.

---

## Phase 1: npm Ecosystem (LOW effort)

All JS package managers can install from npm. One publish covers:
- `npm i -g lazyjuju` / `npx lazyjuju`
- `bunx lazyjuju`
- `pnpm add -g lazyjuju` / `pnpm dlx lazyjuju`
- `yarn global add lazyjuju` / `yarn dlx lazyjuju`

**Note:** All methods require [Bun](https://bun.sh) to be installed (OpenTUI runtime dependency).

### Changes Required

1. **package.json**:
```json
{
  "name": "lazyjuju",
  "version": "0.1.0",
  "private": false,  // Remove or set false
  "bin": {
    "lazyjuju": "./bin/lazyjuju.js",
    "ljj": "./bin/lazyjuju.js"
  },
  "files": ["bin", "src", "dist"],
  // ... rest unchanged
}
```

2. **bin/lazyjuju.js** (entry script):
```javascript
#!/usr/bin/env bun
import "../src/index.tsx"
```

3. **Publish**:
```bash
npm publish
# or
bun publish
```

---

## Phase 2: Homebrew (MEDIUM effort)

Create a Homebrew tap:

```bash
brew tap YOUR_USERNAME/lazyjuju
brew install lazyjuju
```

Requirements:
- Create `homebrew-lazyjuju` repo with formula
- Binary releases on GitHub (compiled with `bun build --compile`)
- Formula that downloads and installs binary
- CI to update formula on release

---

## Phase 3: curl Installer (MEDIUM effort)

Like opencode's installer:

```bash
curl -fsSL https://lazyjuju.dev/install | bash
```

Requirements:
- Install script (detect OS/arch, download binary)
- Binary builds for: darwin-arm64, darwin-x64, linux-arm64, linux-x64
- GitHub releases or CDN hosting
- PATH setup in shell config

Reference: [opencode install script](https://github.com/anomalyco/opencode/blob/dev/install)

---

## GitHub Releases & CI

Automated releases with:
- Semantic versioning (or date-based: `2026.01.15`)
- Changelog generation (git-cliff or similar)
- Binary builds for macOS/Linux (arm64, x64)

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags: ["v*"]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      # Build binaries
      # Create GitHub release
      # Publish to npm
      # Update Homebrew formula
```

---

## Auto-Updater

Two approaches, implement both:

### 1. Update Notification

Check for updates on startup (non-blocking):

```typescript
// Check GitHub releases API
const latest = await fetch('https://api.github.com/repos/USER/lazyjuju/releases/latest')
if (semver.gt(latest.tag, currentVersion)) {
  showToast(`Update available: ${latest.tag}`)
}
```

- Check frequency: Once per day (store last check timestamp)
- Non-blocking: Don't delay startup, check in background
- Show: "Update available: v1.2.3 — run `lazyjuju update` to install"

### 2. Self-Update Command

```bash
lazyjuju update        # Check and install update
lazyjuju update --check  # Just check, don't install
```

Implementation:
1. Detect install method (npm, brew, binary)
2. For npm: Run `npm update -g lazyjuju`
3. For brew: Run `brew upgrade lazyjuju`
4. For binary: Download + replace + restart

### Update Flow

```
┌─ Update Available ──────────────────────────────────────────────┐
│                                                                 │
│  lazyjuju v1.2.3 is available (current: v1.2.0)                 │
│                                                                 │
│  Changes:                                                       │
│  • Added interactive splitting                                  │
│  • Fixed diff rendering performance                             │
│                                                                 │
│  [Enter] Install now    [Escape] Later    [n] Don't ask again   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tasks

**Phase 1 (npm):**
- [ ] Add `"bin"` and `"files"` to package.json
- [ ] Remove `"private": true`
- [ ] Create `bin/lazyjuju.js` entry script
- [ ] Test with `npm link` locally
- [ ] Publish to npm

**Phase 2 (Homebrew):**
- [ ] Create `homebrew-lazyjuju` tap repo
- [ ] Add binary build to CI
- [ ] Create formula
- [ ] Test installation

**Phase 3 (curl):**
- [ ] Create install script
- [ ] Add binary builds to release workflow
- [ ] Host install script

**Phase 4 (Auto-update):**
- [ ] Implement update check on startup
- [ ] Add `lazyjuju update` command
- [ ] Detect install method for appropriate update
