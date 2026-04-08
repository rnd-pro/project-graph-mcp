# lang-python.js

## Notes
- Python file parser using regex to extract classes, functions, imports, and exports.
- Relies on indentation tracking to determine scope boundaries (class vs top-level).
- Used by `parser.js` to process Python backend services in multi-language projects.

## Edge Cases
- Multi-line `from ... import (...)` statements are manually stitched together before parsing.
- Does not parse nested functions or complex decorators perfectly.
- Implicitly exports all top-level elements unless `__all__` is explicitly defined.

## Decisions
- Used regex and indentation counting instead of a full Python AST parser to keep dependencies zero and execution fast.
- Chosen to pre-process and remove docstrings and comments to avoid matching text inside them.

## TODO
- Better support for deeply nested class scopes and inner functions.
