# Custom Diff Renderer

> Unified diff rendering for view mode, PR review, and interactive splitting.

**Status**: Planning  
**Priority**: High  
**Goal**: Consistent diff experience across all modes with support for interactivity

---

## Overview

Build a custom diff renderer using `@pierre/diffs` for parsing and data structures, with a custom OpenTUI renderer. This provides:

1. **Consistent look** - Same rendering in view mode and interactive modes
2. **Interactivity** - Hunk selection, navigation, annotations
3. **PR review** - Inline comments, GitHub sync
4. **Escape hatch** - Toggle to ANSI passthrough for users who prefer difftastic/delta

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Input                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│    jj diff -r <rev> --git --no-color                                    │
│    OR gh pr diff --patch (for PR review)                                │
│              │                                                          │
│              ▼                                                          │
│    ┌─────────────────────┐                                              │
│    │  @pierre/diffs      │                                              │
│    │  parsePatchFiles()  │                                              │
│    └─────────────────────┘                                              │
│              │                                                          │
│              ▼                                                          │
│    ┌─────────────────────┐      ┌─────────────────────┐                 │
│    │  FileDiffMetadata[] │ ───► │  DiffRowIndex       │                 │
│    │  (parsed hunks)     │      │  (stable anchors)   │                 │
│    └─────────────────────┘      └─────────────────────┘                 │
│              │                           │                              │
│              └───────────┬───────────────┘                              │
│                          │                                              │
│                          ▼                                              │
│              ┌─────────────────────┐                                    │
│              │  File-at-a-time     │                                    │
│              │  OpenTUI Renderer   │                                    │
│              └─────────────────────┘                                    │
│                          │                                              │
│         ┌────────────────┼────────────────┐                             │
│         ▼                ▼                ▼                             │
│    ┌─────────┐    ┌───────────┐    ┌───────────┐                        │
│    │  View   │    │ PR Review │    │ Interactive│                       │
│    │  Mode   │    │   Mode    │    │  Splitting │                       │
│    └─────────┘    └───────────┘    └───────────┘                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Parsing (using @pierre/diffs)

```typescript
import { parsePatchFiles, type FileDiffMetadata, type Hunk } from '@pierre/diffs'

// Fetch git-format diff from jj
const rawDiff = await execute(['diff', '-r', rev, '--git', '--no-color'])

// Parse into structured data
const patches = parsePatchFiles(rawDiff)
const files: FileDiffMetadata[] = patches[0]?.files ?? []
```

**Key types from @pierre/diffs:**

```typescript
interface FileDiffMetadata {
  name: string
  prevName: string | undefined  // for renames
  type: 'change' | 'rename-pure' | 'rename-changed' | 'new' | 'deleted'
  hunks: Hunk[]
  splitLineCount: number
  unifiedLineCount: number
  oldLines?: string[]  // full file content (for expansion)
  newLines?: string[]
}

interface Hunk {
  collapsedBefore: number
  additionStart: number
  additionCount: number
  deletionStart: number
  deletionCount: number
  hunkContent: (ContextContent | ChangeContent)[]
  hunkContext: string | undefined  // e.g., "function foo()"
  hunkSpecs: string | undefined    // raw @@ line
}

interface ContextContent {
  type: 'context'
  lines: string[]
}

interface ChangeContent {
  type: 'change'
  deletions: string[]
  additions: string[]
}
```

### 2. Stable Identifiers (Critical)

**Do NOT key state by array indices.** Indices break when:
- File filtering/sorting changes
- GitHub sends files in different order
- "View only this file" / "unviewed only" filtering
- Jump to file

Instead, use **stable identifiers**:

```typescript
// File identifier: path (+ prevName for renames)
type FileId = string  // path, or `${prevName}->${name}` for renames

function fileId(file: FileDiffMetadata): FileId {
  if (file.prevName) return `${file.prevName}->${file.name}`
  return file.name
}

// Hunk identifier: derived from header coordinates
interface HunkId {
  fileId: FileId
  deletionStart: number
  deletionCount: number
  additionStart: number
  additionCount: number
}

function hunkId(file: FileDiffMetadata, hunk: Hunk): string {
  const fid = fileId(file)
  return `${fid}:${hunk.deletionStart},${hunk.deletionCount}:${hunk.additionStart},${hunk.additionCount}`
}

// Line anchor for PR comments (matches GitHub API)
interface LineAnchor {
  path: string
  side: 'LEFT' | 'RIGHT'  // GitHub terminology: LEFT=old, RIGHT=new
  line: number
}
```

### 3. Row Index (Mapping Layer)

Each rendered row carries its full coordinate context. This enables:
- Consistent selection/hover across unified vs split views
- Annotation anchoring that survives view mode changes
- GitHub comment placement (path, side, line)

```typescript
interface DiffRow {
  // Row type
  type: 'context' | 'addition' | 'deletion' | 'hunk-header' | 'file-header'
  
  // Position in both view modes
  unifiedRowIndex: number
  splitRowIndex: number  // column-relative in split view
  
  // Line numbers
  lineNumber?: number      // primary (new for additions, old for deletions)
  altLineNumber?: number   // secondary (old line when showing new, etc.)
  
  // Side for annotation anchoring
  side: 'LEFT' | 'RIGHT' | null  // null for context (both sides)
  
  // Content
  content: string
  
  // Parent references (stable IDs, not indices)
  fileId: FileId
  hunkId: string
}

// Build row index from parsed files
function buildRowIndex(files: FileDiffMetadata[]): DiffRow[] {
  // Flatten hunks into rows with full coordinate info
  // ...
}
```

### 4. State Management

```typescript
interface DiffState {
  files: FileDiffMetadata[]
  mode: 'view' | 'review' | 'split'
  
  // Navigation (by stable ID, not index)
  currentFileId: FileId | null
  currentHunkId: string | null
  
  // Selection for split mode (keyed by stable hunk ID)
  hunkSelections: Map<string, 'keep' | 'split'>
  
  // Annotations for review mode (keyed by line anchor)
  annotations: Map<string, DiffAnnotation[]>  // key: `${path}:${side}:${line}`
  
  // Layout
  viewStyle: 'unified' | 'split'
  
  // Current file being rendered (file-at-a-time)
  activeFileId: FileId | null
}

interface DiffAnnotation {
  anchor: LineAnchor
  type: 'comment' | 'suggestion' | 'ai-explanation'
  content: string
  author?: string
  
  // GitHub sync
  prCommentId?: number
  threadId?: string
  resolved?: boolean
}
```

---

## Performance: File-at-a-Time Rendering

**Problem:** Rendering all lines as JSX would regress the diff virtualization win from PTY streaming + progressive limit. 10k+ nodes = slowdown.

**Solution:** File-at-a-time rendering.

```typescript
function DiffRenderer(props: { state: DiffState }) {
  // Only render the currently active file
  const activeFile = createMemo(() => 
    props.state.files.find(f => fileId(f) === props.state.activeFileId)
  )
  
  return (
    <box flexDirection="column">
      {/* File picker / list */}
      <FileList 
        files={props.state.files} 
        activeFileId={props.state.activeFileId}
        onSelect={(id) => setActiveFile(id)}
      />
      
      {/* Single file view */}
      <Show when={activeFile()}>
        {(file) => (
          <FileView 
            file={file()} 
            state={props.state}
          />
        )}
      </Show>
    </box>
  )
}
```

**Why this works:**
- PR review UX naturally reviews file-by-file
- Massively reduces rendered rows
- Same substrate supports splitting (mark hunks in active file)
- Full commit diff still available via file navigation

**Alternative:** If "entire commit diff" is needed, implement row-level virtualization (only render visible rows + buffer), similar to current `limit()` approach in MainArea.tsx.

---

## View Modes

### Unified View (default for narrow terminals)

Single column with +/- indicators:

```
src/auth.ts
@@ -10,6 +10,8 @@ function validate()
   function validate(input) {
-    return true
+    if (!input) throw new Error('required')
+    return isValid(input)
   }
```

### Split View (default for wide terminals)

Side-by-side with aligned lines:

```
┌─ Old ─────────────────────────┬─ New ─────────────────────────┐
│ 10   function validate(input) │ 10   function validate(input) │
│ 11     return true            │ 11     if (!input) throw ...  │
│                               │ 12     return isValid(input)  │
│ 12   }                        │ 13   }                        │
└───────────────────────────────┴───────────────────────────────┘
```

**Auto-switching:**
- `< 100 cols` → Force unified
- `100-140 cols` → Default unified, allow split
- `> 140 cols` → Default split

User can toggle with `v` keybind.

---

## Word-Level Highlighting

Use `diff` npm package for intra-line changes:

```typescript
import { diffWords } from 'diff'

function highlightInlineChanges(oldLine: string, newLine: string) {
  const changes = diffWords(oldLine, newLine)
  
  return changes.map(change => ({
    text: change.value,
    type: change.added ? 'added' : change.removed ? 'removed' : 'unchanged'
  }))
}
```

---

## Escape Hatch: ANSI Passthrough

For users who prefer difftastic/delta, or for large diffs where structured rendering is too slow:

```typescript
// Toggle with 'd' keybind
const [renderMode, setRenderMode] = createSignal<'custom' | 'passthrough'>('custom')

// In config
interface DiffConfig {
  defaultRenderer: 'custom' | 'passthrough'
  passthroughCommand?: string  // e.g., 'difft' or 'delta'
}
```

Passthrough mode uses existing `<ghostty-terminal>`:
```tsx
<Show when={renderMode() === 'passthrough'}>
  <ghostty-terminal ansi={rawAnsiDiff()} cols={terminalWidth()} />
</Show>
```

---

## PR Review: GitHub Patch Alignment

When reviewing PRs, use GitHub's patch format as the canonical source:

```typescript
// Fetch PR patches via GitHub API
const prFiles = await ghApi(`/repos/${owner}/${repo}/pulls/${prNumber}/files`)

for (const file of prFiles) {
  // file.patch is the same unified diff format
  const parsed = parsePatchFiles(file.patch)
  // ...
}
```

**Why this matters:** GitHub's PR file patches are the canonical "diff context" GitHub uses for comment placement. When we parse the same patch text, our `(path, side, line)` mapping matches their expectations.

---

## Dependency Consideration

`@pierre/diffs` brings along Shiki and web rendering infrastructure, even if we only need parsing.

**If bundle size/startup becomes an issue:**
1. Vendor just the parsing utilities (`parsePatchFiles`, type definitions) into kajji
2. Or request upstream subpath exports like `@pierre/diffs/parse`

For now: use full dependency, monitor perf, revisit if needed.

---

## File Structure

```
src/
├── diff/
│   ├── index.ts              # Exports
│   ├── parser.ts             # Wrapper around @pierre/diffs
│   ├── identifiers.ts        # fileId(), hunkId(), LineAnchor
│   ├── row-index.ts          # DiffRow, buildRowIndex()
│   ├── state.ts              # DiffState types and helpers
│   ├── navigation.ts         # Hunk/file navigation logic
│   └── word-diff.ts          # Intra-line highlighting
├── components/
│   └── diff/
│       ├── DiffView.tsx      # Main diff component (file-at-a-time)
│       ├── FileList.tsx      # File picker/navigator
│       ├── FileView.tsx      # Single file rendering
│       ├── HunkView.tsx      # Single hunk rendering
│       ├── LineView.tsx      # Single line with highlighting
│       ├── SplitView.tsx     # Side-by-side layout
│       └── UnifiedView.tsx   # Single-column layout
```

---

## Implementation Phases

**Note:** Interactive splitting comes before PR review. Splitting only needs hunk-level identification (path + @@ coords), while PR review needs full line-level anchoring for GitHub API compatibility.

### Phase 1: Basic Rendering (MVP)
- [ ] Add `@pierre/diffs` dependency
- [ ] Create parser wrapper (`src/diff/parser.ts`)
- [ ] Implement stable identifiers (`src/diff/identifiers.ts`)
- [ ] Basic file-at-a-time unified view
- [ ] Add `d` toggle to switch to passthrough

### Phase 2: Enhanced Viewing
- [ ] File list/navigator component
- [ ] Split (side-by-side) view
- [ ] Auto-switch based on terminal width
- [ ] Word-level highlighting
- [ ] Hunk navigation (`[`/`]`)

### Phase 3: Interactive Splitting
- [ ] Hunk selection state (keyed by stable hunkId)
- [ ] Visual selection indicators
- [ ] Split mode entry/exit
- [ ] Execute split with selections
- → See [interactive-splitting.md](./interactive-splitting.md)

### Phase 4: PR Review Features
- [ ] Fetch PR patches via GitHub API
- [ ] Annotation anchoring with LineAnchor (line-level, not just hunk-level)
- [ ] Inline comment rendering
- [ ] Comment input modal
- [ ] GitHub comment sync
- → See [pr-management.md](./pr-management.md)

### Phase 5: AI Features
- [ ] Hunk selection for AI context
- [ ] AI explanation modal
- [ ] Integration with `kajji ai explain`
- → See [ai-integration.md](./ai-integration.md)

---

## Testing Strategy

### Unit Tests
- Parser wrapper: various diff formats, edge cases
- Stable identifiers: renames, special characters in paths
- Row index: coordinate consistency across views
- Navigation: hunk/file boundaries, empty states

### Visual Tests
- Different file types
- Large single-file diffs
- Rename detection
- Binary file handling

### Benchmarks
- Parse time for large diffs
- Render time: file-at-a-time vs full diff
- Comparison with ANSI passthrough

---

## Open Questions

1. ~~**Syntax highlighting approach**: Shiki ANSI vs OpenTUI tree-sitter?~~ → Using Shiki via `@pierre/diffs`
2. **Full commit diff**: File-at-a-time only, or virtualized full view?
3. **Collapsible hunks**: Support collapsing unchanged regions?
4. **Line numbers**: Show git line numbers or 1-indexed from hunk?
5. ~~**Theme integration**: How to match kajji's theme system?~~ → See Theming section below

---

## Theming

### Current State

**Syntax highlighting**: Uses `ayu-dark` Shiki theme (via `@pierre/diffs`). Hardcoded in `src/diff/syntax.ts`.

**Diff colors**: Hardcoded in `src/components/diff/SplitDiffView.tsx`:
```typescript
const DIFF_BG = {
  addition: "#12211E",
  deletion: "#361815",
  empty: "#1a1a1a",
  hunkHeader: "#1a1a2e",
  additionEmphasis: "#1a4a1a",
  deletionEmphasis: "#4a1a1a",
}

const BAR_COLORS = {
  addition: "#00cab1",
  deletion: "#ff2e3f",
}
```

### Future Work

**Refactor diff tokens to theme system:**
- [ ] Move `DIFF_BG`, `BAR_COLORS`, `EMPTY_STRIPE_COLOR` to `src/theme/types.ts`
- [ ] Add `diff` section to theme presets (lazygit, opencode)
- [ ] Access via `useTheme()` → `colors().diff.additionBg` etc.

**Syntax highlighting theme selection:**
- [ ] Map kajji theme → Shiki theme (e.g., lazygit → `github-dark`, opencode → `ayu-dark`)
- [ ] Config option: `syntax.theme = "auto" | "<shiki-theme-name>"`
- [ ] Auto mode: detect closest matching Shiki theme for current kajji theme

**Advanced (optional):**
- [ ] Detect terminal colorscheme and adapt (like bat/delta)
- [ ] Custom Shiki theme registration for perfect theme matching
- [ ] Consider: terminal-native ANSI colors vs hardcoded hex (16-color mode support)

**Available Shiki themes** (dark): `ayu-dark`, `github-dark`, `vitesse-dark`, `tokyo-night`, `catppuccin-mocha`, `nord`, `dracula`, `one-dark-pro`, etc.

**Reference:** See `context/references/reference-pierre-diffs.md` for pierre theme structure and CSS variable patterns.

---

## References

- [@pierre/diffs](https://github.com/pierrecomputer/pierre/tree/main/packages/diffs) - Diff rendering library
- [lumen](https://github.com/jnsahaj/lumen) - Rust CLI with custom diff rendering
- [lazygit](https://github.com/jesseduffield/lazygit) - TUI staging approach (different model)
- [OpenTUI diff component](https://github.com/sst/opentui) - Built-in diff support
