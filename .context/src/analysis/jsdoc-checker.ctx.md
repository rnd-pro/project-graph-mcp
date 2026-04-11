# jsdoc-checker.js

## Notes
- Validates JSDoc annotations against actual AST function signatures.
- Checks for param count/name mismatches, missing `@returns`, and type hint inconsistencies.
- Infers expected types from default parameter values (e.g. `param = []` infers `Array`).

## Edge Cases
- Parses complex nested JSDoc types (e.g. `{Array<{text: string}>}`) correctly by tracking brace depth.
- Strips brackets `[]` from optional parameters and ignores nested properties (e.g. `options.include`) when matching names.

## Decisions
- Uses AST parsing (`acorn`) instead of regex for function extraction to guarantee accuracy across arrow functions, methods, and exports.
- Treats missing JSDoc as a non-issue here; that is delegated to the `undocumented.js` checker.

## TODO
- Expand inferred type checks to include TypeScript annotations if they exist in `.ts` files.
