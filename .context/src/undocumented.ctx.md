# undocumented.js

## Notes
- Scans functions, methods, and classes for missing JSDoc annotations
- Supports three strictness levels: `tests` (requires `@test`/`@expect`), `params` (adds `@param`/`@returns`), and `all` (adds class descriptions)
- Uses Acorn AST combined with regex-based comment extraction to link JSDocs to AST nodes based on line numbers
- Exposes `checkUndocumentedFile` for per-file caching

## Edge Cases
- JSDoc is only linked if it appears within 2 lines directly above the AST node declaration
- Ignores private methods/functions (prefixed with `_`) and getters/setters
- Explicitly skips standard lifecycle methods like `constructor`, `connectedCallback`, and `renderCallback`

## Decisions
- Regex comment extraction was chosen over Acorn's comment array to more easily control comment-to-node distance heuristics
- The default strictness level (`tests`) enforces a test-driven development culture by mandating `@test` annotations rather than just types

## TODO
- Validate that `@param` and `@returns` tags actually match the function's real signature
- Add support for detecting undocumented exported variables and constants