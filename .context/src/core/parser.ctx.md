# parser.js

## Notes
- Parses JS/TS/SQL/Py/Go files into unified AST representations using Acorn & custom parsers.
- Extracts classes, functions, methods, exports, and tracks dependencies (calls, DB reads/writes).
- Feeds raw structured data into `graph-builder.js` and architectural tools.

## Edge Cases
- Fails gracefully on parsing errors by returning an empty result to avoid crashing the analyzer.
- SQL extraction relies on specific DB client methods (`query`, `execute`, etc.) and tagged templates.

## Decisions
- Used `acorn` and `acorn-walk` for lightweight, fast, standard JS parsing instead of heavier TS compiler API.
- Unified DB extraction with general call extraction in a single AST walk for better performance.

## TODO
- Add support for detecting dynamic imports and `require` statements.