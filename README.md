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

- **Full-color diffs** — works with difftastic, delta, or your configured diff tool
- **Commit log** — navigate jj's graph with vim-style keybindings
- **Bookmarks panel** — drill down into commits and files
- **Collapsible file tree** — with status colors (A/M/D)
- **Operation log** — view and restore from jj op history
- **Git operations** — fetch and push
- **Undo/redo** — with confirmation showing what will change
- **Help palette** — press `?` for all keybindings with fuzzy search

## Installation

> **Requirements**: [Bun](https://bun.sh) and [jj](https://github.com/martinvonz/jj)

```bash
# npm
npm install -g kajji

# bun
bun install -g kajji

# pnpm
pnpm add -g kajji

# or run directly
bunx kajji
```

### From source

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

## Next up

- Multi-select for batch rebase and squash
- Search and filter (log, bookmarks, files)
- Workspaces tab (monitor agent commits across workspaces)

## Exploring

- Interactive `jj split` (file/hunk selection)
- Stacked PR creation and overview
- Configuration (user config file, theme switching)

See [PROJECT](./context/PROJECT.md) for the full plan.

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
