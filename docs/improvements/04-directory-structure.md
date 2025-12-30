# Directory Structure Evolution

## Current

```
src/
├── commander/
├── components/
│   └── panels/
├── context/
├── App.tsx
└── index.tsx
```

## Proposed (when project grows)

```
src/
├── commander/        # jj CLI wrappers
├── components/
│   ├── common/       # Button, Input, Modal, etc.
│   ├── panels/       # LogPanel, DiffPanel, etc.
│   └── modals/       # DescribeModal, ConfirmModal
├── context/          # State providers
├── theme/            # Colors, tokens, ThemeProvider
├── hooks/            # useKeymap, useFocus, useDebounce
├── lib/              # Utilities (stripAnsi, etc.)
├── App.tsx
└── index.tsx
```

Implement gradually as new directories are needed. No single action required.

---

**Priority**: Low effort | Medium impact | Ongoing
