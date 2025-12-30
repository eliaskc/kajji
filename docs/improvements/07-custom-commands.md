# Custom Commands

**Pattern from lazyjj**: Read from jj's config file

```toml
# In jj config (e.g., ~/.jjconfig.toml)
[lazierjj.commands]
fixup = "jj squash --into @-"
sync = "jj git fetch && jj rebase -d main@origin"
```

## With Placeholder Support (from jjui)

```toml
[lazierjj.commands]
cherry-pick = "jj new $change_id"
diff-tool = "jj diff -r $change_id --tool difft"
```

## Available Placeholders

- `$change_id` - Selected commit's change ID
- `$commit_id` - Selected commit's commit ID
- `$bookmark` - Selected bookmark name
- `$file` - Selected file in diff

## Implementation

1. Parse config from jj's standard location
2. Build command string with placeholders
3. Execute via `execute()` from commander
4. Show output in command log panel

---

**Priority**: Low effort | Medium impact | Post-MVP
