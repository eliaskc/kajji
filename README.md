<p align="center">
  <img alt="kajji" src="./assets/kajji.gif">
</p>

A simple [jj](https://github.com/martinvonz/jj) terminal UI with custom diff rendering.

![normal mode](./assets/normal-mode.png)

Reviewing local code has never been as prominent as it is today. Coding agents are writing line upon line, and your sorry eyes are the ones that need to trudge through it.

Kajji makes this new reality less painful with polished jj navigation and manipulation alongside Shiki-powered diff rendering with syntax highlighting and word-level diffs. To allow for jj's log to get the real estate it deserves when you're looking at the diff, while also allowing the width required for side-by-side diff rendering, kajji has two view modes: normal and diff. Switch with ctrl+x and try it out.

![diff mode](./assets/diff-mode.png)

Why build this? While learning jj I found myself coming back to lazygit to do this quickly and easily - the options for jj didn't quite scratch that lazygit itch of speed, simplicity and polish.

Kajji is my attempt to bring the UX of lazygit to jj, while also aiming for top-class diff rendering and exploring leveraging coding agents effectively. I'm building this for myself first and foremost, but I hope it can be helpful to others too.

## Installation

> **Requirements**: [jj](https://github.com/martinvonz/jj)

```bash
# recommended (standalone binary, no dependencies)
curl -fsSL https://kajji.sh/install.sh | bash

# or via package manager
npm install -g kajji
bun install -g kajji
pnpm add -g kajji
yarn global add kajji

# or run directly without installing
npx kajji
bunx kajji
```

### From source

> **Requirements**: [Bun](https://bun.sh)

```bash
git clone https://github.com/eliaskc/kajji.git
cd kajji
bun install
bun dev
```

## Principles

- **Polish & simplicity** - Do less, but do it well.
- **Intuitive UX** - Sensible defaults, consistent patterns.
- **Snappy** - If it feels slow, it's a bug.

## Features

**Core jj operations:**

- [x] View commit log with graph
- [x] View diffs with syntax highlighting and word-level emphasis
- [x] New / edit / describe / squash / abandon
- [x] Rebase with revision picker
- [x] Split (suspends TUI for jj's native split)
- [x] Undo / redo with preview
- [x] Bookmarks (create, delete, rename, move)
- [x] Git fetch / push
- [x] Operation log with restore
- [ ] Conflict resolution

**TUI polish:**

- [x] Vim-style navigation (j/k, ctrl+u/d)
- [x] Mouse support (click, double-click, horizontal scroll)
- [x] Collapsible file tree with status colors
- [x] Help palette with fuzzy search (`?`)
- [x] Focus modes for normal browsing vs diff viewing
- [x] Line wrapping toggle (`w`) and split/unified view (`v`)
- [x] Binary file detection
- [x] Recent repository switcher
- [x] Automatic update notifications
- [x] Revset filtering and fuzzy search
- [x] JSONC config with live reload and schema autocomplete
- [x] Open files in editor from file view (`e`/`E`)
- [ ] Multi-select for batch operations

## Usage

Run `kajji` in any jj repository:

```bash
kajji                    # current directory
kajji /path/to/repo      # specific directory
```

### CLI

Kajji includes a small CLI for scripting and agent workflows:

```bash
# List changes with addressable hunk IDs
kajji changes -r @

# Comments
kajji comment list -r @
kajji comment set -r @ --hunk h1 -m "note"
kajji comment set -r @ --file src/App.tsx --line 12 -m "note"
kajji comment delete -r @ --hunk h1
kajji comment delete -r @ --file src/App.tsx --line 12
kajji comment delete -r @ --file src/App.tsx
kajji comment delete -r @ --all -y
```

### Configuration

Kajji reads JSONC config from `~/.config/kajji/config.json` (comments and trailing commas are supported).

- Open it from the command palette (`?`) with `open config`
- Changes from `open config` are reloaded when you return to kajji
- Schema autocomplete is available via `$schema` in the generated config

```jsonc
{
  "$schema": "https://kajji.sh/schema.json",
  "ui": {
    "theme": "lazygit",       // "lazygit" | "opencode"
    "showFileTree": true
  },
  "diff": {
    "layout": "auto",         // "auto" | "unified" | "split"
    "autoSwitchWidth": 120,   // only used when layout is "auto"
    "wrap": true,
    "useJjFormatter": false   // use jj's ui.diff-formatter output in Detail
  },
  "whatsNewDisabled": false
}
```

Not yet wired from config ([#16](https://github.com/eliaskc/kajji/issues/16)):

- keybind overrides

### Keybindings

| Key       | Action                            |
| --------- | --------------------------------- |
| `j` / `k` | Move down / up                    |
| `Tab`     | Cycle focus between panels        |
| `Enter`   | Drill into commit / file          |
| `Escape`  | Back / close modal                |
| `ctrl+x`  | Toggle focus mode (normal / diff) |
| `ctrl+o`  | Open recent repository            |
| `o`       | Open commit/PR on GitHub          |
| `-`       | Toggle tree/list (Files) or jj formatter (Detail) |
| `w`       | Toggle line wrapping in diff (built-in renderer) |
| `v`       | Toggle split / unified diff (built-in renderer) |
| `ctrl+p`  | Show commands (or `?`)            |
| `q`       | Quit                              |

### Operations

| Key       | Action                  |
| --------- | ----------------------- |
| `n` / `N` | New change / new before |
| `e`       | Edit change             |
| `d`       | Describe change         |
| `s`       | Squash                  |
| `a`       | Abandon change          |
| `r`       | Rebase                  |
| `S`       | Split                   |
| `u` / `U` | Undo / redo             |
| `f` / `F` | Git fetch / fetch all   |
| `p` / `P` | Git push / push all     |

### Bookmarks

| Key | Action                 |
| --- | ---------------------- |
| `c` | Create bookmark        |
| `d` | Delete bookmark        |
| `r` | Rename bookmark        |
| `b` | Set bookmark on commit |
| `m` | Move bookmark          |

See [GitHub issues](https://github.com/eliaskc/kajji/issues) for the roadmap.

## Built With

- [OpenTUI](https://github.com/sst/opentui) + [SolidJS](https://www.solidjs.com/) - Modern TypeScript TUI framework
- [Bun](https://bun.sh) - Fast JavaScript runtime
- [jj (Jujutsu)](https://github.com/martinvonz/jj) - Git-compatible VCS

## Related Projects

- [lazygit](https://github.com/jesseduffield/lazygit) - The inspiration for this project
- [jjui](https://github.com/idursun/jjui) - Go-based jj TUI
- [lazyjj](https://github.com/Cretezy/lazyjj) - Rust-based jj TUI

## License

MIT
