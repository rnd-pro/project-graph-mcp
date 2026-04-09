# test-annotations.js

## Notes
- Parses markdown checklists from `.ctx.md` files to track testing progress.
- Supports `[ ]` (pending), `[x]` (passed), and `[!]` (failed) markers in `## Tests` sections.
- State is file-based — `markTestPassed`/`markTestFailed` write directly to `.ctx.md` files.

## Edge Cases
- Test step IDs are generated sequentially based on heading context, so reordering checklist items may shift IDs.
- Assumes `findJSFiles` should ignore `.css.js` and `.tpl.js` files to speed up scanning.

## Decisions
- State stored in `.ctx.md` files (not in-memory) — survives process restarts and is visible in version control.
- Designed to allow testing features incrementally without needing a full test-runner suite like Jest or Playwright.

## TODO
- Support nested checklist hierarchies for complex test scenarios.
