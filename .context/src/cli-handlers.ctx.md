# cli-handlers.js

## Notes
- Maps individual CLI commands (e.g., `skeleton`, `expand`, `analyze`) to the core functions in `tools.js` and others.
- Extracts argument parsing logic (`--flag=value`) from raw `process.argv` arrays.
- Standardizes path resolution using `workspace.js` before passing arguments to the business layer.

## Edge Cases
- Flags without `=value` are handled manually (e.g., checking if the array `.includes('--problematic')`).
- If no path is provided, it correctly defaults to the workspace root (`.`).

## Decisions
- Isolated from `cli.js` to drastically reduce cyclomatic complexity and improve module testability.
- Avoided 3rd-party arg parsers to keep the bundle size small and load time extremely fast.

## TODO
- Standardize flag parsing into a unified utility function to prevent repeated `args.includes` checks.