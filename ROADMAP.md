# Project Graph MCP — Roadmap

## v1.1 — Code Analysis Tools

### Phase 1: Dead Code Detection ✅
- [x] `get_dead_code` — Find unused functions/classes
  - Leverage existing dependency graph
  - Detect orphan nodes (no incoming edges)
  - Exclude entry points (exports, event handlers)

### Phase 2: JSDoc Generation ✅
- [x] `generate_jsdoc` — Auto-generate JSDoc from AST
  - Extract parameter names and types (if available)
  - Infer return type from return statements
  - Generate template with @param/@returns from AST

### Phase 3: Similar Functions Detection ✅
- [x] `get_similar_functions` — Find functional duplicates
  - Compare function signatures (param count, names)
  - Analyze AST structure patterns
  - Score similarity (0-100%)

### Phase 4: Complexity Analysis ✅
- [x] `get_complexity` — Cyclomatic complexity metrics
  - Count decision points (if/for/while/switch)
  - Flag functions over threshold (e.g., >10)
  - Generate refactoring suggestions

---

## v1.2 — AI Context Layer ✅

### Phase 1: Code Compression ✅
- [x] `get_compressed_file` — Terser-minified source with export legend
  - Vendored Terser in `vendor/terser.mjs` (zero deps)
  - Beautified output for readability
  - 20-55% token savings per file

### Phase 2: Doc Dialect ✅
- [x] `get_project_docs` — Compact documentation from AST + manual `.context/` files
- [x] `generate_context_docs` — Generate `.context/*.ctx` templates
  - AST-enriched templates with call chains per function
  - `{DESCRIBE}` markers for agent enrichment (use `doc-enricher` skill)
  - `@sig` structural hash for staleness detection
  - Merge strategy preserves existing descriptions on regenerate
- [x] `check_stale_docs` — Detect outdated .ctx files via AST signature comparison

### Phase 3: AI Context Boot ✅
- [x] `get_ai_context` — Single-call aggregator
  - Skeleton + docs + compressed files
  - ~1700 tokens for full project (~97% savings)

---

## v1.3 — Type Safety & Agent Notes

### Phase 1: Two-Tier .ctx Architecture ✅
- [x] `.ctx` — Machine zone: AST-generated, @sig tracked, overwritten on regen
- [x] `.ctx.md` — Agent zone: Notes, TODO, Decisions (never overwritten)
- [x] `getProjectDocs` merges both when serving context
- [x] Self-enriching `@enrich` blocks for agent-driven documentation

### Phase 2: JSDoc Type Checking ✅
- [x] **Tier 1 — Built-in (no deps)**: AST-based JSDoc consistency checks
  - Param count mismatch (JSDoc says 3, function takes 2)
  - Param name mismatch (`@param {string} name` but param is `user`)
  - Missing @returns on non-void functions
  - Type hint inconsistency (default value vs JSDoc type)
  - Included in `get_full_analysis` health score (-2/error, -1/warning)
- [x] **Tier 2 — Optional `tsc`**: Full type validation for JS+JSDoc
  - `check_types(path)` — spawn `tsc --checkJs --allowJs --noEmit`
  - Uses existing `tsconfig.json`/`jsconfig.json` or CLI flags
  - Graceful fallback if `tsc` not in PATH
  - Structured diagnostics: file, line, severity, message
  - NOT included in health score (optional tool)

### Phase 3: Performance & Caching
- [x] **Cache module** (`analysis-cache.js`) — dual hashing primitives
  - `computeSig()` / `computeContentHash()` — interface + body hashes
  - `readCache()` / `writeCache()` / `isCacheValid()` — file I/O
  - Storage: `.context/.cache/parser.json` (gitignored)
- [x] **Cache integration** into `get_full_analysis` (incremental per-file)
  - Per-file loop: read code → check cache → compute or reuse → write cache
  - **Cacheable**: complexity, undocumented, jsdocConsistency
  - **NOT cacheable** (cross-file): dead code, similarity
  - Result includes `cache: { hits, misses }` stats
- [x] **Warm-up**: `generate_context_docs` pre-populates cache during per-file AST pass
- [x] **Test migration**: `@test/@expect` → `## Tests` in `.ctx.md` files
  - `test-annotations.js` rewritten: parses markdown checklists
  - `markTestPassed`/`markTestFailed` write directly to `.ctx.md`
  - State is file-based (no in-memory Map)
  - Removed `@test/@expect` from: jsdoc-generator, undocumented, instructions, tool-defs
- [x] **Batch concurrency** for `generate_context_docs` (batches of 5 files)
- [x] **Recursive project support** (monorepo scanning via `discover_sub_projects`)
- [x] **Streaming large codebase analysis** (`getFullAnalysisStreaming` async generator + `get_analysis_summary` quick check)

---

## Implementation Notes

All tools follow the pattern:
1. New module in `src/` (e.g., `dead-code.js`)
2. Tool definition in `tool-defs.js`
3. Handler in `mcp-server.js`
4. CLI command in `cli.js`
5. Test in `tests/mcp.test.js`

