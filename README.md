![kajji ascii art](./assets/kajji.png)

A simple [jj](https://github.com/martinvonz/jj) terminal UI with custom diff rendering. 

![normal mode](./assets/normal-mode.png)

Reviewing local code has never been as prominent as it is today. Coding agents are writing line upon line, and your sorry eyes are the ones that need to trudge through it.

Kajji makes this new reality less painful with polished jj navigation and manipulation alongside Shiki-powered diff rendering with syntax highlighting and word-level diffs. To allow for jj's log to get the real estate it deserves when you're looking at the diff, while also allowing the width required for side-by-side diff rendering, kajji has two view modes: normal and diff. Switch with ctrl+x and try it out. 

![diff mode](./assets/diff-mode.png)

Why build this? While learning jj I found myself coming back to lazygit to do this quickly and easily - the options for jj didn't quite scratch that lazygit itch of speed, simplicity and polish.

Kajji is my attempt to bring the UX of lazygit to jj, while also aiming for top-class diff rendering and exploring leveraging coding agents effectively. I'm building this for myself first and foremost, but I hope it can be helpful to others too.

> Disclaimer: almost all code in this project has been written by coding agents (primarily Claude Opus 4.5 through [OpenCode](https://github.com/sst/opencode) (100% via API of course 😌)).

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
- [x] Mouse support (click, double-click, scroll)
- [x] Collapsible file tree with status colors
- [x] Help palette with fuzzy search (`?`)
- [x] Focus modes for normal browsing vs diff viewing
- [x] Recent repository switcher
- [x] Automatic update notifications
- [ ] Multi-select for batch operations
- [ ] Search and filter

## Usage

Run `kajji` in any jj repository:

```bash
kajji                    # current directory
kajji /path/to/repo      # specific directory
```

### Keybindings

| Key | Action |
| --- | ------ |
| `j` / `k` | Move down / up |
| `Tab` | Cycle focus between panels |
| `Enter` | Drill into commit / file |
| `Escape` | Back / close modal |
| `ctrl+x` | Toggle focus mode (normal / diff) |
| `ctrl+o` | Open recent repository |
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
| `r` | Rebase |
| `S` | Split |
| `u` / `U` | Undo / redo |
| `f` / `F` | Git fetch / fetch all |
| `p` / `P` | Git push / push all |

### Bookmarks

| Key | Action |
| --- | ------ |
| `c` | Create bookmark |
| `d` | Delete bookmark |
| `r` | Rename bookmark |
| `b` | Set bookmark on commit |
| `m` | Move bookmark |

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
