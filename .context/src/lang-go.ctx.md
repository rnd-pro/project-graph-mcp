# lang-go.js

## Notes
- Go source code parser extracting structs, interfaces, methods, functions, and imports.
- Maps Go `struct` and `interface` constructs to "classes" for uniform graph representation.
- Filters out standard Go keywords and standard library calls to reduce noise in the call graph.

## Edge Cases
- Block body extraction relies on brace counting `{}`, which can break if braces inside strings aren't fully stripped.
- Method calls on variables (`s.Handle`) are stripped of the receiver, storing only `Handle` unless the receiver is a known package.

## Decisions
- Mapped Go structs and interfaces to the generic `classes` array to maintain compatibility with JS/TS and Python graph builders.
- Two-pass import extraction: first parses import blocks `import (...)`, then single-line imports.

## TODO
- Improve receiver type tracking to map method calls more accurately to their corresponding structs.
