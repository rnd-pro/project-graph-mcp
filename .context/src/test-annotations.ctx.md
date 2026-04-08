# test-annotations.js

## Notes
- Parses JSDoc `@test` and `@expect` annotations to track and manage browser testing progress.
- Maintains an in-memory state (`testState`) of passed/failed/pending steps across CLI sessions.
- Generates markdown checklists to serve as interactive test plans for agents.

## Edge Cases
- Test step IDs are generated sequentially based on the method name (`methodName.0`, `methodName.1`), so changing the order of `@test` annotations invalidates the saved state.
- Assumes `findJSFiles` should ignore `.css.js` and `.tpl.js` files to speed up scanning.

## Decisions
- Kept state in-memory rather than writing to disk to avoid filesystem sync issues during fast, parallel test execution by agents.
- Designed to allow testing features incrementally without needing a full test-runner suite like Jest or Playwright configured.

## TODO
- Add persistent storage for test state so progress isn't lost if the CLI process restarts.
