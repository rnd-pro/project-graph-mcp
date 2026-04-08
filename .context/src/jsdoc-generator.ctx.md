# jsdoc-generator.js

## Notes
- Auto-generates JSDoc templates for functions, methods, and classes by analyzing the AST.
- Extracts parameter names (including rest/destructured) and infers basic types from default values.
- Optionally injects `@test` and `@expect` placeholders for Agentic Verification.

## Edge Cases
- Skips generating JSDoc for functions that already have one (detects existing `/** ... */` block just above the function).
- Ignores constructors, getters/setters, and methods starting with `_` (assumed private).

## Decisions
- Leaves `TODO` markers in descriptions and test annotations to actively prompt developers (or AI agents) to complete them.
- Simplifies destructured object parameters to just `options` and arrays to `args` for cleaner generated docs.

## TODO
- Better type inference from function body assignments (e.g., inferring return type from `return` statements).
