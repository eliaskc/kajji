# Update Project Documentation

When working on this project, keep documentation in sync with changes. This skill should be triggered after completing significant work.

## Key Documents

Check these files and update as needed:

### Primary (most important)
- **`context/PROJECT.md`** — Single source of truth for features, plans, and known issues
  - Check off completed features
  - Add new bugs to "Known Issues"
  - Add new goals/features as checkboxes
  - Update status of in-progress work

### Secondary
- **`README.md`** — Public-facing documentation
  - Update only for user-visible changes (new features, keybindings, installation)
  - Keep features list accurate
  - Don't update for internal refactors

- **`AGENTS.md`** — Agent guidelines and project patterns
  - Add new patterns discovered during implementation
  - Update architecture notes if structure changes
  - Add useful commands or workflows

### This Skill
- **`.claude/skills/update-docs/SKILL.md`** — This file
  - Update if documentation structure changes
  - Add new key documents if created

## When to Update

| Trigger | Action |
|---------|--------|
| Feature implemented | Check off in `PROJECT.md` |
| Bug found | Add to `PROJECT.md` under "Known Issues" |
| Major feature done | Update `README.md` features/keybindings |
| New pattern discovered | Add to `AGENTS.md` |
| Design decision made | Document in `context/plans/*.md` |
| Breaking change | Update `README.md` and `AGENTS.md` |

## When NOT to Update

- Minor refactors (no functional change)
- Internal code changes that don't affect features
- Test additions (unless documenting test patterns)
- Dependency updates (unless breaking)

## Context Directory Structure

```
context/
  PROJECT.md          # Primary tracker (features, plans, issues)
  plans/              # Detailed feature specs
  references/         # Analysis of other projects
  archive/            # Historical docs
  llm-suggestions/    # AI-generated ideas (low priority)
```

## Process

1. After completing work, review what changed
2. Determine which docs need updates (use table above)
3. Make minimal, accurate updates
4. Don't over-document — keep it concise
