# analysis-cache.js

## Notes
- Manages a persistent, file-based cache for analysis results in `.context/.cache/`.
- Uses a dual-hashing strategy: `sig` (interface hash) and `contentHash` (full body hash).
- Caches per-file metrics like complexity, undocumented items, and JSDoc issues.

## Edge Cases
- Cache read/write/delete operations are wrapped in try-catch to be non-fatal; the system gracefully degrades to un-cached mode on failure.

## Decisions
- Separates interface signatures from body content hashes to avoid invalidating documentation or structural caches when only internal function logic changes.
- Stores data as pretty-printed JSON for easy inspection and debugging.

## TODO
- Cross-file analysis (like dead code or similarity) is currently uncacheable; could explore strategies for caching these.
