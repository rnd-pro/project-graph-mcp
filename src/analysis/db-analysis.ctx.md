# db-analysis.js

## Notes
- Provides MCP tools for code-database interactions (`getDBSchema`, `getTableUsage`, `getDBDeadTables`).
- Uses `parser.js` and `graph-builder.js` to trace SQL queries back to the functions and classes that execute them.
- Analyzes both `.sql` schema dumps and inline SQL strings.

## Edge Cases
- Column usage detection is heuristic-based (scanning SQL strings near DB calls) and intentionally accepts false negatives to avoid falsely flagging columns as "dead".
- Adding generic columns (`id`, `uuid`, `created_at`, `updated_at`) to the referenced set prevents them from being reported as dead everywhere.

## Decisions
- Implemented a best-effort, zero-dependency approach to find DB dead code to provide immediate value without requiring a heavy SQL AST parser or runtime tracing.
- Decided to map DB operations as specific graph edges (`R→`, `W→`) for unified graph querying.

## TODO
- Improve precision of column usage tracking by integrating a more robust SQL query tokenizer.
