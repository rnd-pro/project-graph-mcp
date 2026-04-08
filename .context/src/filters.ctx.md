# filters.js

## Notes
- Manages file and directory exclusion logic (e.g., `node_modules`, `dist`, `.gitignore` rules).
- Exposes mutable configuration allowing the agent to dynamically tweak what gets parsed via MCP.
- Parses `.gitignore` natively to prevent indexing files that aren't source-controlled.

## Edge Cases
- Manual exclusion updates persist only for the session lifecycle, they aren't written to disk.
- Complex gitignore patterns (like negation `!`) might not be fully supported by the basic wildcard matcher.

## Decisions
- Rolled a custom lightweight wildcard/gitignore matcher instead of bringing in heavy glob dependencies.
- Placed default ignores inside the code to ensure sensible zero-config behavior out of the box.

## TODO
- Add full support for `!` negation patterns in `.gitignore`.