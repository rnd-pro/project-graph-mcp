# lang-typescript.js

## Notes
- Regex-based TS/TSX parser for extracting structural elements (classes, functions, imports, exports, calls).
- Exists to avoid the heavy performance cost and complexity of AST parsers like Acorn for TypeScript.
- Connects to `parser.js` and `graph-builder.js` as the primary engine for analyzing TS/JS files.

## Edge Cases
- Does not parse nested functions correctly, only top-level functions and class methods.
- Strip strings and comments before parsing to prevent false positive matches.
- Ignores type-only declarations (`type`, `interface`) as they have no runtime impact.

## Decisions
- Chose regex over Acorn to prevent catastrophic backtracking and support broken/incomplete code.
- Chosen to strip comments and strings first (`lang-utils.js`) to simplify the regex logic.

## TODO
- Improve support for complex nested arrow functions and object destructuring in exports.
