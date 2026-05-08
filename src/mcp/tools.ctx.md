# tools.js

## Notes
- Implements the core business logic for graph analysis tools exposed via MCP.
- Orchestrates parsing, graph building, and provides a smart `mtime`-based caching layer.
- Functions like `getSkeleton`, `expand`, and `getCallChain` run complex graph queries.

## Edge Cases
- Caching relies on `mtimeMs`; file changes update the cache gracefully but require a full graph rebuild.
- Ignores cache save errors (e.g. read-only filesystem) to remain resilient in CI environments.

## Decisions
- Cache is saved to `.project-graph-cache.json` on disk to speed up subsequent MCP client restarts.
- Used BFS for `getCallChain` to guarantee finding the shortest path between symbols.

## Tests
- [ ] getSkeleton: parse project → returns minified graph with legend
- [ ] expand: expand minified symbol → returns full details with methods
- [ ] getCallChain: find path A→B → returns shortest BFS chain

## TODO
- Implement truly incremental graph updates instead of full rebuilds on single file changes.