# kajji

> The rudder for your jj

A simple terminal UI for [Jujutsu](https://github.com/martinvonz/jj), inspired by [lazygit](https://github.com/jesseduffield/lazygit). Built with [OpenTUI](https://github.com/sst/opentui) and [SolidJS](https://www.solidjs.com/).

![kajji screenshot](./assets/kajji.png)

While learning jj I found myself coming back to lazygit to view diffs and traverse the changes I'd made quickly and easily, which has become increasingly important to me with the rise of coding agents. While there are existing jj TUIs, none quite scratched that lazygit itch.

Kajji is my attempt to bring the simplicity and polish of lazygit to jj, while also leveraging coding agents effectively and building a TUI for the first time.

> Disclaimer: almost all code in this project has been written by coding agents (primarily Claude Opus 4.5 through [OpenCode](https://github.com/sst/opencode)).

## Principles

- **Polish & simplicity** - Do less, but do it well.
- **Intuitive UX** - Sensible defaults, consistent patterns.
- **Snappy** - If it feels slow, it's a bug.

## Features

**Core jj operations:**
- [x] View commit log with graph
- [x] View diffs (difftastic, delta, etc.)
- [x] New / edit / describe / squash / abandon
- [x] Undo / redo with preview
- [x] Bookmarks (create, delete, rename, move)
- [x] Git fetch / push
- [x] Operation log with restore
- [ ] Rebase
- [ ] Split
- [ ] Conflict resolution

**TUI polish:**
- [x] Vim-style navigation (j/k, ctrl+u/d)
- [x] Mouse support (click, double-click, scroll)
- [x] Collapsible file tree with status colors
- [x] Help palette with fuzzy search (`?`)
- [ ] Multi-select for batch operations
- [ ] Search and filter

## Installation

> **Requirements**: [jj](https://github.com/martinvonz/jj)

```bash
# recommended (standalone binary, no dependencies)
curl -fsSL https://raw.githubusercontent.com/eliaskc/kajji/main/install.sh | bash

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

## Usage

Run `kajji` in any jj repository:

```bash
kajji
```

### Keybindings

| Key | Action |
| --- | ------ |
| `j` / `k` | Move down / up |
| `Tab` | Cycle focus between panels |
| `Enter` | Drill into commit / file |
| `Escape` | Back / close modal |
| `?` | Show help with fuzzy search |
| `q` | Quit |

### Operations

| Key | Action |
| --- | ------ |
| `n` | New change |
| `e` | Edit change |
| `d` | Describe change |
| `s` | Squash into parent |
| `a` | Abandon change |
| `u` / `U` | Undo / redo |
| `f` / `F` | Git fetch / fetch all |
| `p` / `P` | Git push / push all |

### Bookmarks

| Key | Action |
| --- | ------ |
| `c` | Create bookmark |
| `d` | Delete bookmark |
| `r` | Rename bookmark |
| `b` | Create bookmark on commit |

See [PROJECT](./context/PROJECT.md) for the full roadmap.

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
