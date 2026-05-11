# jsdoc-generator.js

## Notes
- Auto-generates JSDoc templates for functions, methods, and classes by analyzing the AST.
- Extracts parameter names (including rest/destructured) and infers basic types from default values.

## Edge Cases
- Skips generating JSDoc for functions that already have one (detects existing `/** ... */` block just above the function).
- Ignores constructors, getters/setters, and methods starting with `_` (assumed private).

## Decisions
- Uses neutral placeholder descriptions so generated JSDoc does not introduce persistent audit debt markers.
- Simplifies destructured object parameters to just `options` and arrays to `args` for cleaner generated docs.

## Follow-ups
- Better type inference from function body assignments (e.g., inferring return type from `return` statements).
