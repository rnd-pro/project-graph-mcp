# dead-code.js

## Notes
- Detects unused functions, classes, exports, variables, and imports using AST analysis
- Performs cross-file import tracking by scanning the entire project root for import consumers
- Variables and imports usage is verified using regex heuristics rather than full scope tracking for performance
- Integrates with `.gitignore` and custom filter configurations

## Edge Cases
- Syntax errors in files cause them to be silently skipped
- Test files (`.test.js`, `/tests/`) and presentation files (`.css.js`, `.tpl.js`) are ignored
- Private functions (starting with `_`) are excluded from dead function detection
- Regex variable usage detection might produce false positives if variable names match strings or comments exactly

## Decisions
- Regex usage heuristic chosen over full AST scope tracking to keep memory usage low and execution fast
- Orphan exports are checked globally to prevent false positives in library-like internal modules

## TODO
- Implement full scope analysis for variable usage to eliminate regex false positives
- Add support for detecting dead properties on objects and classes