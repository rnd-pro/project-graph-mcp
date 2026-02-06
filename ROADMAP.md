# Project Graph MCP — Roadmap

## v1.1 — Code Analysis Tools

### Phase 1: Dead Code Detection ✅
- [x] `get_dead_code` — Find unused functions/classes
  - Leverage existing dependency graph
  - Detect orphan nodes (no incoming edges)
  - Exclude entry points (exports, event handlers)

### Phase 2: JSDoc Generation
- [ ] `generate_jsdoc` — Auto-generate JSDoc from AST
  - Extract parameter names and types (if available)
  - Infer return type from return statements
  - Generate template with @test/@expect placeholders

### Phase 3: Similar Functions Detection
- [ ] `get_similar_functions` — Find functional duplicates
  - Compare function signatures (param count, names)
  - Analyze AST structure patterns
  - Score similarity (0-100%)

### Phase 4: Complexity Analysis
- [ ] `get_complexity` — Cyclomatic complexity metrics
  - Count decision points (if/for/while/switch)
  - Flag functions over threshold (e.g., >10)
  - Generate refactoring suggestions

---

## Implementation Notes

All tools follow the pattern:
1. New module in `src/` (e.g., `dead-code.js`)
2. Tool definition in `tool-defs.js`
3. Handler in `mcp-server.js`
4. CLI command in `cli.js`
5. Test in `tests/mcp.test.js`
