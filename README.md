# lazyjuju

> Disclaimer: almost all code in this project has been written by coding agents (primarily Claude Opus 4.5 through [OpenCode](https://github.com/sst/opencode)).

A simple terminal UI for [jj (Jujutsu)](https://github.com/martinvonz/jj), inspired by [lazygit](https://github.com/jesseduffield/lazygit). Built with [OpenTUI](https://github.com/sst/opentui) and [SolidJS](https://www.solidjs.com/).

<!-- TODO: demo GIF -->

While learning jj I found myself coming back to lazygit to view diffs and traverse the changes I'd made quickly and easily, which has become increasingly important to me with the rise of coding agents. While there are better and more feature-rich jj TUIs, I found none quite gave me a painfree experience for this primary use case.

Lazyjuju is my attempt to bring the simplicity and polish of lazygit to JJ, while also letting me experiment with using coding agents to a greater extent, building a TUI for the first time and getting more familiar with jj in the process.

## Principles

- **Polish & simplicity** — Do less, but do it well.
- **Intuitive UX** — Sensible defaults, consistent patterns.
- **Snappy** — If it feels slow, it's a bug.

## Features

- **Full-color diffs** - Works with your configured diff tool (difftastic, delta, etc.)
- **Commit log** - Navigate jj's graph with vim-style keybindings
- **Bookmarks panel** - Browse bookmarks with drill-down into commits and files
- **File tree** - Collapsible folders, file status colors (A/M/D)
- **Theming** - Multiple themes (lazygit-style, opencode-style) with terminal adaptation
- **Searchable help** - Press `?` for all keybindings, with fuzzy search

## Installation

> **Requirements**: [Bun](https://bun.sh) and [jj](https://github.com/martinvonz/jj)

### From source

```bash
git clone https://github.com/YOUR_USERNAME/lazyjuju.git
cd lazyjuju
bun install
bun dev
```

<!-- TODO: Add when released
### Homebrew

```bash
brew install lazyjuju
```

### npx

```bash
bunx lazyjuju
```
-->

## Usage

Run `lazyjuju` (or `ljj`) in any jj repository:

```bash
bun dev
```

### Navigation

| Key         | Action                             |
| ----------- | ---------------------------------- |
| `j` / `k`   | Move down / up                     |
| `Tab`       | Cycle focus between panels         |
| `1` `2` `3` | Jump to panel directly             |
| `Enter`     | Drill into commit (show file tree) |
| `Escape`    | Back / close modal                 |

### Actions

| Key      | Action                      |
| -------- | --------------------------- |
| `R`      | Refresh                     |
| `?`      | Show help                   |
| `Ctrl+Y` | Copy selection to clipboard |
| `q`      | Quit                        |

### Operations

| Key | Action              |
| --- | ------------------- |
| `n` | New change          |
| `e` | Edit change         |
| `d` | Describe change     |
| `s` | Squash into parent  |
| `a` | Abandon change      |

## Roadmap

**Coming soon:**

- Search and filter (`/`)
- Command mode (`:`)
- Mouse support
- Auto-refresh on file changes
- GitHub integration (create PR, open in browser)
- Configuration (user config file, theme selection)

See [ROADMAP](./context/ROADMAP.md) for the full plan.

## Configuration

> Configuration support is coming. See [configuration plan](./context/plans/configuration.md).

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
