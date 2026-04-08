# graph-builder.js

## Notes
- Converts raw parsed AST data into a highly compressed, minified graph representation.
- Creates a `legend` to map full names to 2-3 character minified symbols (e.g., `togglePin` -> `tP`).
- Connects nodes with edges for method calls (`→`) and DB operations (`R→`, `W→`).

## Edge Cases
- Handles name collisions in the minified legend by appending numeric suffixes (`tP1`, `tP2`).
- Nodes with no incoming edges (except exports) are flagged as orphans (dead code).

## Decisions
- Token efficiency is the primary goal: minified keys drastically reduce context usage for LLM prompts.
- Separated graph building from parsing to allow caching and fast incremental updates.

## TODO
- Add edge types for class inheritance and property access chains.