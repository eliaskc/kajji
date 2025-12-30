# Future Improvements - lazierjj

> Improvements identified but deferred for later phases.
> Based on analysis of opencode, jjui, lazyjj, and OpenTUI patterns.

## All Improvements

1. [01 - Theme System Evolution](./01-theme-system.md) - Token-based theming with multiple phases
2. [02 - Context Decomposition](./02-context-decomposition.md) - Split sync.tsx into focused contexts
3. [03 - Keyboard Architecture](./03-keyboard-architecture.md) - Refactor keyboard handling
4. [04 - Directory Structure](./04-directory-structure.md) - Organize as project grows
5. [05 - Command Palette](./05-command-palette.md) - Searchable command registry
6. [06 - Multi-Select Support](./06-multi-select.md) - Batch operations on commits
7. [07 - Custom Commands](./07-custom-commands.md) - User-defined commands in jj config
8. [08 - Frame Pacing](./08-frame-pacing.md) - Optimize render performance

## Priority Matrix

| Improvement | Effort | Impact | Timeline |
|-------------|--------|--------|----------|
| Theme tokens (Phase 1) | Low | High | **Done** ✓ |
| Test coverage | Low | Medium | **Done** ✓ |
| Theme context (Phase 2) | Medium | Medium | When users request themes |
| System theme (Phase 3) | Medium | Low | When users report clashes |
| Context split | Low | Medium | When adding bookmarks |
| Keyboard registry | Medium | High | When adding command palette |
| Command palette | High | High | Post-MVP |
| Multi-select | Medium | Medium | Post-MVP |
| Custom commands | Low | Medium | Post-MVP |
| Frame pacing | Low | Low | If performance issues |

## Quick Links

- [Reference docs](../references/) - Analysis of similar projects
- [Implementation order](../../plans/implementation-order.md) - Prototype phases
- [Main plan](../../plans/lazyjj-plan.md) - Full feature specification
